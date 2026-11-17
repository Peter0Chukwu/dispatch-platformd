import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.types';

/** Statuses in which the two people on a job may reasonably need to talk. */
const TALKABLE = new Set([
  'ASSIGNED',
  'ACCEPTED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
]);

/** How long a call may ring before it is treated as missed. */
const RING_MS = 45_000;
/** A hard ceiling, so a call the browser forgot to end cannot live forever. */
const CALL_MS = 60 * 60 * 1000;

interface LiveCall {
  id: string;
  deliveryId: string;
  callerUserId: string;
  calleeUserId: string;
  callerType: 'CUSTOMER' | 'RIDER';
  startedAt: number;
  answeredAt: number | null;
  ringTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

/**
 * How the broker tells the sockets about something it decided on its own — a call
 * that rang out, or one that hit the hour ceiling. Wired once by the gateway; if
 * nothing is listening (a unit test, a CLI) the bookkeeping still happens.
 */
export interface CallNotifier {
  missed(userIds: string[], callId: string): void;
}

export type CallLeg = {
  callId: string;
  deliveryId: string;
  /** Who to relay to. Never sent to the browser — the broker uses it itself. */
  peerUserId: string;
  peerType: 'CUSTOMER' | 'RIDER';
};

export type CallOutcome =
  | { ok: true; call: CallLeg }
  | { ok: false; error: string; message: string };

/**
 * IN-APP CALLING — the broker between two browsers
 *
 * Why this exists: the promise is that a customer and a rider can talk without
 * either learning the other's phone number, and that the channel disappears when
 * the job ends. The original plan was a provider that rents a proxy number, but
 * number masking in Nigeria needs KYC, a pending-released number pool and
 * per-minute billing — and until that account exists the Call button did nothing.
 *
 * A voice call placed *inside* the app keeps the same promise with no number
 * involved at all: the audio never leaves the two browsers (WebRTC, peer to peer),
 * and this service is only the introduction. That also makes the rule enforceable:
 *
 *   · only the two parties of that delivery may call each other
 *   · only while the job is live (before pickup and after delivery, no)
 *   · a fresh call id every time, so an old id cannot be replayed
 *   · ringing expires on its own
 *
 * What it does NOT do: route audio through the server, record anything, or tell
 * anybody a phone number. `CallSession` rows stay reserved for a future
 * number-masking provider.
 *
 * Scale note: the registry is in memory, so it assumes one API instance (true of
 * the current single-service deployment). Running more than one instance needs
 * the registry moved to Redis — the same shape, a different store.
 */
@Injectable()
export class CallSignalingService {
  private readonly logger = new Logger('CallSignaling');
  private readonly calls = new Map<string, LiveCall>();
  private notifier: CallNotifier | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The gateway registers itself here so timers can emit. */
  attachNotifier(notifier: CallNotifier): void {
    this.notifier = notifier;
  }

  /** Calls in flight right now — used by the health/status view and tests. */
  get activeCount(): number {
    return this.calls.size;
  }

  /**
   * A participant asks to call the other side.
   *
   * Everything is decided from the database here: which delivery, who is on it,
   * whether it is still live. The socket handshake already proved *who* is asking.
   */
  async start(principal: AuthPrincipal, deliveryId: string): Promise<CallOutcome> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, customerId: true, riderId: true },
    });
    // Not found and not-yours answer identically: a stranger learns nothing about
    // somebody else's parcel by probing ids.
    if (!delivery) return deny('NOT_FOUND', 'Delivery not found');

    const isCustomer = Boolean(principal.customerId) && delivery.customerId === principal.customerId;
    const isRider = Boolean(principal.riderId) && delivery.riderId === principal.riderId;
    if (!isCustomer && !isRider) return deny('NOT_FOUND', 'Delivery not found');

    if (!delivery.riderId) return deny('NO_RIDER', 'Nobody is carrying this delivery yet.');

    // A finished job must not reopen a line between the two people — that is the
    // whole point of not handing out numbers.
    if (!TALKABLE.has(delivery.status)) {
      return deny('CLOSED', 'This delivery is closed, so calling is no longer available.');
    }

    const callerType: 'CUSTOMER' | 'RIDER' = isCustomer ? 'CUSTOMER' : 'RIDER';
    const peerUserId = await this.peerUserIdFor(delivery, callerType === 'CUSTOMER' ? 'RIDER' : 'CUSTOMER');
    if (!peerUserId) return deny('NO_RIDER', 'The other person is not reachable right now.');

    // One call at a time per person: a second tap replaces nothing, it is refused,
    // so two tabs cannot start a ringing war.
    const busy = await this.busyCallFor(principal.userId, peerUserId);
    if (busy !== 'none') {
      return deny(
        busy === 'caller' ? 'ALREADY_CALLING' : 'PEER_BUSY',
        busy === 'caller' ? 'You are already on a call.' : 'They are on another call right now.',
      );
    }

    const call: LiveCall = {
      id: randomUUID(),
      deliveryId: delivery.id,
      callerUserId: principal.userId,
      calleeUserId: peerUserId,
      callerType,
      startedAt: Date.now(),
      answeredAt: null,
    };
    this.calls.set(call.id, call);

    // Ring once, then give up; and a ceiling in case both browsers vanish.
    call.ringTimer = this.after(RING_MS, () => {
      const live = this.calls.get(call.id);
      if (!live || live.answeredAt) return;
      this.clear(call.id);
      this.notifier?.missed([live.callerUserId, live.calleeUserId], live.id);
      this.logger.log(`Call ${live.id.slice(0, 8)} rang out`);
    });
    call.killTimer = this.after(CALL_MS, () => {
      const live = this.calls.get(call.id);
      if (!live) return;
      this.clear(call.id);
      this.notifier?.missed([live.callerUserId, live.calleeUserId], live.id);
    });

    this.logger.log(`Call ${call.id.slice(0, 8)} ringing: ${callerType} → delivery ${deliveryId.slice(0, 8)}`);

    return {
      ok: true,
      call: {
        callId: call.id,
        deliveryId: call.deliveryId,
        peerUserId,
        peerType: callerType === 'CUSTOMER' ? 'RIDER' : 'CUSTOMER',
      },
    };
  }

  /**
   * Was the phone picked up? Returns who to tell, or null when the call is gone.
   * Only the person being called may accept.
   */
  accept(principal: AuthPrincipal, callId: string): CallOutcome {
    const call = this.calls.get(callId);
    if (!call || call.calleeUserId !== principal.userId) return deny('NOT_FOUND', 'That call has ended.');

    call.answeredAt = Date.now();
    // Answered: the ringing deadline no longer applies.
    if (call.ringTimer) clearTimeout(call.ringTimer);
    call.ringTimer = undefined;

    return {
      ok: true,
      call: {
        callId: call.id,
        deliveryId: call.deliveryId,
        peerUserId: call.callerUserId,
        peerType: call.callerType,
      },
    };
  }

  /** Decline, hang up, or give up. Any participant may end the call. */
  end(principal: AuthPrincipal, callId: string): { ended: boolean; peerUserId?: string; deliveryId?: string } {
    const call = this.calls.get(callId);
    if (!call) return { ended: false };
    if (call.callerUserId !== principal.userId && call.calleeUserId !== principal.userId) return { ended: false };

    this.clear(call.id);
    const peerUserId = call.callerUserId === principal.userId ? call.calleeUserId : call.callerUserId;
    this.logger.log(
      `Call ${call.id.slice(0, 8)} ended after ${call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0}s`,
    );
    return { ended: true, peerUserId, deliveryId: call.deliveryId };
  }

  /**
   * WebRTC offers, answers and ICE candidates.
   *
   * Checked against the call registry, not trusted from the client: a socket may
   * only relay to the other leg of a call it is actually part of.
   */
  relay(principal: AuthPrincipal, callId: string, payload: unknown): { peerUserId: string } | null {
    const call = this.calls.get(callId);
    if (!call) return null;
    const isCaller = call.callerUserId === principal.userId;
    const isCallee = call.calleeUserId === principal.userId;
    if (!isCaller && !isCallee) return null;
    // Signalling before pickup is only offers from the caller; audio starts after
    // the callee accepts, so nothing to protect beyond the pair themselves.
    return { peerUserId: isCaller ? call.calleeUserId : call.callerUserId };
  }

  /** Nobody could be reached: used by the ringing timer. */
  expire(callId: string): { callerUserId: string; calleeUserId: string } | null {
    const call = this.calls.get(callId);
    if (!call) return null;
    this.clear(callId);
    return { callerUserId: call.callerUserId, calleeUserId: call.calleeUserId };
  }

  /** Disconnect handling: a dropped socket must not leave a call ringing. */
  endForUser(userId: string): string[] {
    const ended: string[] = [];
    for (const call of [...this.calls.values()]) {
      if (call.callerUserId !== userId && call.calleeUserId !== userId) continue;
      this.clear(call.id);
      ended.push(call.id);
    }
    return ended;
  }

  /* ─────────────────────────────── internals ─────────────────────────────── */

  private async peerUserIdFor(
    delivery: { customerId: string; riderId: string | null },
    side: 'CUSTOMER' | 'RIDER',
  ): Promise<string | null> {
    if (side === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: delivery.customerId },
        select: { user: { select: { id: true } } },
      });
      return customer?.user?.id ?? null;
    }
    if (!delivery.riderId) return null;
    const rider = await this.prisma.rider.findUnique({
      where: { id: delivery.riderId },
      select: { user: { select: { id: true } } },
    });
    return rider?.user?.id ?? null;
  }

  private async busyCallFor(userId: string, peerUserId: string): Promise<'none' | 'caller' | 'peer'> {
    for (const call of this.calls.values()) {
      if (call.callerUserId === userId || call.calleeUserId === userId) return 'caller';
      if (call.callerUserId === peerUserId || call.calleeUserId === peerUserId) return 'peer';
    }
    return 'none';
  }

  private after(ms: number, run: () => void): NodeJS.Timeout {
    const timer = setTimeout(run, ms);
    // A pending timer must never hold the process open (tests, short-lived CLIs).
    timer.unref?.();
    return timer;
  }

  private clear(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    if (call.ringTimer) clearTimeout(call.ringTimer);
    if (call.killTimer) clearTimeout(call.killTimer);
    this.calls.delete(callId);
  }

  /** Removed automatically after the call ends, so nothing accumulates in tests. */
  reset(): void {
    for (const id of [...this.calls.keys()]) this.clear(id);
  }
}

function deny(error: string, message: string): CallOutcome {
  return { ok: false, error, message };
}
