import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallSignalingService } from '../src/realtime/call-signaling.service';
import type { AuthPrincipal } from '../src/auth/auth.types';

/**
 * In-app calling — who may ring whom, and for how long.
 *
 * The promise to the user is narrow and must hold exactly: the two people on a
 * live delivery can call each other, inside the app, with no phone number
 * exchanged, and the line closes when the job does.
 */

const principal = (over: Partial<AuthPrincipal> = {}): AuthPrincipal =>
  ({
    userId: 'user-customer',
    type: 'CUSTOMER',
    audience: 'CUSTOMER',
    customerId: 'cust-1',
    roles: [],
    permissions: [],
    ...over,
  }) as AuthPrincipal;

const riderPrincipal = (): AuthPrincipal =>
  principal({ userId: 'user-rider', type: 'RIDER', audience: 'RIDER', customerId: undefined, riderId: 'rid-1' } as never);

/** A Prisma stand-in: only the four lookups the broker performs. */
function stubPrisma(delivery: { id: string; status: string; customerId: string; riderId: string | null } | null) {
  return {
    delivery: { findUnique: vi.fn(async () => delivery) },
    customer: { findUnique: vi.fn(async () => ({ user: { id: 'user-customer' } })) },
    rider: { findUnique: vi.fn(async () => ({ user: { id: 'user-rider' } })) },
  } as never;
}

const liveDelivery = {
  id: 'del-1',
  status: 'IN_TRANSIT',
  customerId: 'cust-1',
  riderId: 'rid-1',
};

describe('phase 7 — in-app calling', () => {
  let service: CallSignalingService | null = null;

  afterEach(() => {
    service?.reset();
    service = null;
    vi.useRealTimers();
  });

  it('rings the other person when a customer calls a live delivery', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));

    const outcome = await service.start(principal(), 'del-1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.call.peerUserId).toBe('user-rider');
    expect(outcome.call.peerType).toBe('RIDER');
    expect(service.activeCount).toBe(1);
  });

  it('lets the rider call the customer back, and never exposes a phone number', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));

    const outcome = await service.start(riderPrincipal(), 'del-1');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.call.peerUserId).toBe('user-customer');
    // The whole object is ids and types — there is no field a number could hide in.
    expect(JSON.stringify(outcome.call)).not.toMatch(/\d{10,}/);
  });

  it('refuses a stranger, without confirming the delivery exists', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));

    const outcome = await service.start(
      principal({ userId: 'user-nosy', customerId: 'cust-999' } as never),
      'del-1',
    );

    expect(outcome).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('refuses when the job is done, so contact ends with the delivery', async () => {
    service = new CallSignalingService(stubPrisma({ ...liveDelivery, status: 'DELIVERED' }));

    const outcome = await service.start(principal(), 'del-1');

    expect(outcome).toMatchObject({ ok: false, error: 'CLOSED' });
  });

  it('refuses before a rider is assigned', async () => {
    service = new CallSignalingService(stubPrisma({ ...liveDelivery, status: 'PENDING', riderId: null }));

    await expect(service.start(principal(), 'del-1')).resolves.toMatchObject({ ok: false, error: 'NO_RIDER' });
  });

  it('answers only for the person being called', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));
    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');

    // The caller cannot answer their own call, and a third party is nowhere.
    expect(service.accept(principal(), started.call.callId)).toMatchObject({ ok: false });
    expect(service.accept(principal({ userId: 'user-other' } as never), started.call.callId)).toMatchObject({
      ok: false,
    });
    expect(service.accept(riderPrincipal(), started.call.callId)).toEqual({
      ok: true,
      call: {
        callId: started.call.callId,
        deliveryId: 'del-1',
        peerUserId: 'user-customer',
        peerType: 'CUSTOMER',
      },
    });
  });

  it('relays WebRTC signalling only between the two legs of one call', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));
    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');

    expect(service.relay(principal(), started.call.callId, { sdp: 'x' })).toEqual({ peerUserId: 'user-rider' });
    expect(service.relay(riderPrincipal(), started.call.callId, { candidate: 'y' })).toEqual({
      peerUserId: 'user-customer',
    });
    expect(service.relay(principal({ userId: 'user-other' } as never), started.call.callId, {})).toBeNull();
    expect(service.relay(principal(), 'made-up-call-id', {})).toBeNull();
  });

  it('ends the call for both when either side hangs up', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));
    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');

    const ended = service.end(riderPrincipal(), started.call.callId);

    expect(ended.ended).toBe(true);
    expect(ended.peerUserId).toBe('user-customer');
    expect(service.activeCount).toBe(0);
    // An ended call cannot be replayed by an old id.
    expect(service.relay(principal(), started.call.callId, {})).toBeNull();
  });

  it('refuses a second call while one is ringing, from either side', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));
    await service.start(principal(), 'del-1');

    // Both of them are already in that call — one ringing call per person, whoever
    // started it, so two taps cannot produce two lines.
    await expect(service.start(principal(), 'del-1')).resolves.toMatchObject({ ok: false, error: 'ALREADY_CALLING' });
    await expect(service.start(riderPrincipal(), 'del-1')).resolves.toMatchObject({ ok: false, error: 'ALREADY_CALLING' });
  });

  it('gives up on its own when nobody answers', async () => {
    vi.useFakeTimers();
    const missed = vi.fn();
    service = new CallSignalingService(stubPrisma(liveDelivery));
    service.attachNotifier({ missed });

    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');

    vi.advanceTimersByTime(46_000);

    expect(missed).toHaveBeenCalledWith(['user-customer', 'user-rider'], started.call.callId);
    expect(service.activeCount).toBe(0);
  });

  it('stops ringing once the call is answered', async () => {
    vi.useFakeTimers();
    const missed = vi.fn();
    service = new CallSignalingService(stubPrisma(liveDelivery));
    service.attachNotifier({ missed });

    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');
    service.accept(riderPrincipal(), started.call.callId);

    vi.advanceTimersByTime(46_000);

    expect(missed).not.toHaveBeenCalled();
    expect(service.activeCount).toBe(1);
  });

  it('clears the line when a closed tab was the last connection', async () => {
    service = new CallSignalingService(stubPrisma(liveDelivery));
    const started = await service.start(principal(), 'del-1');
    if (!started.ok) throw new Error('call should have started');

    expect(service.endForUser('user-customer')).toEqual([started.call.callId]);
    expect(service.activeCount).toBe(0);
  });
});
