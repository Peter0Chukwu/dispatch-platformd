import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import type { PasswordService } from '../src/auth/password.service';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { createTestApp } from './helpers/app';
import {
  VALID_PASSWORD,
  clearRateLimits,
  createApprovedRider,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
} from './helpers/auth-test-helpers';

/**
 * PHASE 6 — THE DISPATCH ENGINE
 *
 * Phase 4 proved that two riders cannot hold the same job. Phase 6 proves that
 * nobody has to be watching when the job needs a rider:
 *
 *   · a booking is offered to the closest riders, in one batch;
 *   · when that batch expires the search widens and asks different people;
 *   · a rider who says no is never asked again;
 *   · when the engine runs out of riders it tells a human instead of going quiet;
 *   · every one of those offers reaches the phone over a live socket;
 *   · and a socket can only ever see what its own token is entitled to.
 *
 * The heartbeat timer is off in tests (see createTestApp); the suite calls
 * `tick()` itself, so nothing depends on waiting for wall-clock time.
 */
describe('Phase 6 — the dispatch engine', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let dispatch: DispatchService;
  let baseUrl: string;
  const sockets: Socket[] = [];

  // Lagos pickup used by every test: Victoria Island.
  const PICKUP = { address: '12 Adeola Odeku Street, Victoria Island', lat: 6.4281, lng: 3.4219 };
  const DEST = { address: '5 Bode Thomas Street, Surulere', lat: 6.4969, lng: 3.3481 };

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
    dispatch = app.get(DispatchService);

    // Socket.IO needs a real listening server; supertest happily reuses the same one.
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4000}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
    // Counters and locks are per-delivery, but a fresh id makes this cheap insurance.
    const keys = await redis.client.keys('dispatch:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  /* ───────────────────────────── helpers ───────────────────────────── */

  /** ~1.11 km per 0.01 degrees of latitude in Lagos. */
  const kmNorth = (km: number) => PICKUP.lat + (km / 111.0);

  const onlineRider = async (options: { km: number; zoneId?: string | null } = { km: 1 }) => {
    const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
    await prisma.rider.update({
      where: { id: rider.riderId },
      data: {
        availability: 'ONLINE',
        ...(options.zoneId !== undefined ? { serviceZoneId: options.zoneId } : {}),
      },
    });
    await prisma.riderLocation.create({
      data: { riderId: rider.riderId, lat: kmNorth(options.km), lng: PICKUP.lng, accuracyM: 10 },
    });
    return rider;
  };

  const book = async (customerToken: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .set({ Authorization: `Bearer ${customerToken}` })
      .send({
        deliveryType: 'STANDARD',
        pickup: { ...PICKUP, contactName: 'Ada Okafor', contactPhone: '+2348039876543' },
        destination: { ...DEST, contactName: 'Chinedu Eze', contactPhone: '+2348069876543' },
        packageCategory: 'DOCUMENTS',
        packageDescription: 'Signed contracts',
        packageWeightKg: 0.5,
        recipientName: 'Chinedu Eze',
        recipientPhone: '+2348069876543',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      })
      .expect(201);
    return { id: res.body.id as string, reference: res.body.reference as string };
  };

  const offersFor = (deliveryId: string) =>
    prisma.deliveryAssignment.findMany({
      where: { deliveryId },
      orderBy: [{ rank: 'asc' }, { offeredAt: 'asc' }],
      select: { id: true, riderId: true, status: true, rank: true, expiresAt: true, method: true },
    });

  /** Push every live offer past its deadline, as if the riders ignored their phones. */
  const letOffersExpire = async (deliveryId: string) => {
    await prisma.deliveryAssignment.updateMany({
      where: { deliveryId, status: 'OFFERED' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  };

  const connect = async (token: string): Promise<Socket> => {
    const socket = io(`${baseUrl}/live`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not connect')), 5000);
      socket.on('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return socket;
  };

  /** Resolves with the first matching event, or rejects on timeout. */
  const waitFor = <T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  /* ─────────────────────── 1. the first round ─────────────────────── */

  describe('the first round', () => {
    it('offers a new booking to the three closest riders, ranked by distance', async () => {
      const customer = await registerAndActivateCustomer(app);
      const riders: Awaited<ReturnType<typeof onlineRider>>[] = [];
      for (const km of [4, 1, 3, 2, 5]) riders.push(await onlineRider({ km }));
      const closestFirst = [1, 2, 3, 4, 5].map((km) => riders.find((_, index) => [4, 1, 3, 2, 5][index] === km)!);

      const delivery = await book(customer.accessToken);
      const offers = await offersFor(delivery.id);

      expect(offers).toHaveLength(3);
      expect(offers.map((offer) => offer.rank)).toEqual([1, 2, 3]);
      expect(offers.every((offer) => offer.status === 'OFFERED')).toBe(true);
      expect(offers.every((offer) => offer.method === 'AUTO')).toBe(true);

      // Rank 1 is the rider who is actually nearest, not the one created first.
      expect(offers[0]!.riderId).toBe(closestFirst[0]!.riderId);
      expect(offers[1]!.riderId).toBe(closestFirst[1]!.riderId);
      expect(offers[2]!.riderId).toBe(closestFirst[2]!.riderId);

      // The two farthest riders are not pestered while the closest three have a live offer.
      const asked = new Set(offers.map((offer) => offer.riderId));
      expect(asked.has(closestFirst[3]!.riderId)).toBe(false);
      expect(asked.has(closestFirst[4]!.riderId)).toBe(false);

      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe('PENDING');
      expect(row.dispatchRound).toBe(1);
    });

    it('prefers a rider in the delivery zone when the distances are close', async () => {
      const customer = await registerAndActivateCustomer(app);
      const zones = await prisma.serviceZone.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

      // Book first so we know which zone the pricing engine put the job in.
      const farInZone = await onlineRider({ km: 4 });
      const delivery = await book(customer.accessToken);
      const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      const zoneId = deliveryRow.serviceZoneId!;
      const otherZone = zones.find((zone) => zone.id !== zoneId)!;

      // Rework the scenario: one rider inside the zone but farther, one outside and closer.
      await prisma.deliveryAssignment.deleteMany({ where: { deliveryId: delivery.id } });
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { dispatchRound: 0, riderId: null, status: 'PENDING' },
      });
      await prisma.rider.update({ where: { id: farInZone.riderId }, data: { serviceZoneId: zoneId } });

      const nearOutsideZone = await onlineRider({ km: 3, zoneId: otherZone.id });
      await prisma.rider.update({ where: { id: farInZone.riderId }, data: { availability: 'ONLINE' } });

      // 4.44 km + 0 zone penalty beats 3.33 km + 3 km zone penalty.
      const sent = await dispatch.offerDelivery(delivery.id);
      expect(sent).toBe(2);

      const offers = await offersFor(delivery.id);
      expect(offers[0]!.riderId).toBe(farInZone.riderId);
      expect(offers[0]!.rank).toBe(1);
      expect(offers[1]!.riderId).toBe(nearOutsideZone.riderId);
    });

    it('records the round even when there is nobody to ask, so the search can widen', async () => {
      const customer = await registerAndActivateCustomer(app);
      // A rider 25 km away: outside round 1's 10 km and round 2's 20 km,
      // inside round 3's 35 km.
      const distant = await onlineRider({ km: 25 });

      const delivery = await book(customer.accessToken);
      expect(await offersFor(delivery.id)).toHaveLength(0);

      const afterFirst = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(afterFirst.dispatchRound).toBe(1);
      expect(afterFirst.status).toBe('PENDING');

      // Round 2 reaches 20 km — still not far enough.
      await dispatch.tick();
      let live = await offersFor(delivery.id);
      expect(live).toHaveLength(0);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).dispatchRound).toBe(2);

      // Round 3 reaches 35 km and finds them.
      await dispatch.tick();
      live = await offersFor(delivery.id);
      expect(live).toHaveLength(1);
      expect(live[0]!.riderId).toBe(distant.riderId);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).dispatchRound).toBe(3);
    });
  });

  /* ─────────────────── 2. escalation and exhaustion ─────────────────── */

  describe('escalation', () => {
    it('asks different riders once a batch expires, without duplicating rows', async () => {
      const customer = await registerAndActivateCustomer(app);
      const riders: Awaited<ReturnType<typeof onlineRider>>[] = [];
      for (const km of [1, 2, 3, 4]) riders.push(await onlineRider({ km }));

      const delivery = await book(customer.accessToken);
      const firstRound = await offersFor(delivery.id);
      expect(firstRound).toHaveLength(3);

      // Nobody answered.
      await letOffersExpire(delivery.id);
      await dispatch.tick();

      const live = await offersFor(delivery.id);
      const liveOffers = live.filter((offer) => offer.status === 'OFFERED' && offer.expiresAt.getTime() > Date.now());
      expect(liveOffers).toHaveLength(1);
      // The fourth rider — the one who was not asked a minute ago.
      expect(liveOffers[0]!.riderId).toBe(riders[3]!.riderId);

      // One row per rider, forever: the unique (delivery, rider) key is respected.
      expect(new Set(live.map((offer) => offer.riderId)).size).toBe(live.length);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).dispatchRound).toBe(2);
    });

    it('comes back to the first riders in a later round instead of giving up', async () => {
      const customer = await registerAndActivateCustomer(app);
      const riders: Awaited<ReturnType<typeof onlineRider>>[] = [];
      for (const km of [1, 2, 3, 4]) riders.push(await onlineRider({ km }));

      const delivery = await book(customer.accessToken);
      await letOffersExpire(delivery.id);
      await dispatch.tick(); // round 2 → the fourth rider
      await letOffersExpire(delivery.id);
      await dispatch.tick(); // round 3 → back to the first three

      const all = await offersFor(delivery.id);
      expect(all).toHaveLength(4); // still one row per rider
      const live = all.filter((offer) => offer.status === 'OFFERED');
      expect(live).toHaveLength(3);
      expect(live.map((offer) => offer.riderId).sort()).toEqual(
        [riders[0]!.riderId, riders[1]!.riderId, riders[2]!.riderId].sort(),
      );
    });

    it('never asks a rider again after they decline, and finally alerts the desk', async () => {
      const customer = await registerAndActivateCustomer(app);
      const rider = await onlineRider({ km: 1 });

      const delivery = await book(customer.accessToken);
      const [offer] = await offersFor(delivery.id);
      expect(offer).toBeTruthy();

      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${offer!.id}/reject`)
        .set({ Authorization: `Bearer ${rider.accessToken}` })
        .send({ reason: 'Too far' })
        .expect(201);

      // The only rider said no: the engine records rounds but has nobody left.
      for (let round = 0; round < 4; round += 1) await dispatch.tick();

      const all = await offersFor(delivery.id);
      expect(all).toHaveLength(1); // never re-offered to the rider who declined
      expect(all[0]!.status).toBe('REJECTED');

      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe('PENDING');
      expect(row.dispatchRound).toBeGreaterThanOrEqual(4);

      const alerts = await prisma.adminAlert.findMany({ where: { entityId: delivery.id } });
      expect(alerts).toHaveLength(1); // one page, not one per tick
      expect(alerts[0]!.type).toBe('DISPATCH_EXHAUSTED');
      expect(alerts[0]!.title).toContain(delivery.reference);
    });

    it('is safe to run twice at once: one round, one set of offers', async () => {
      const customer = await registerAndActivateCustomer(app);
      for (const km of [1, 2, 3, 4, 5]) await onlineRider({ km });

      const delivery = await book(customer.accessToken);
      await letOffersExpire(delivery.id);

      const [first, second] = await Promise.all([dispatch.tick(), dispatch.tick()]);
      expect(first.offered + second.offered).toBeLessThanOrEqual(3);

      const offers = await offersFor(delivery.id);
      // At most one new batch; 5 riders, so never more than 3 live at a time.
      const live = offers.filter((offer) => offer.status === 'OFFERED');
      expect(live.length).toBeLessThanOrEqual(3);
      expect(new Set(offers.map((offer) => offer.riderId)).size).toBe(offers.length);
    });
  });

  /* ───────────────────────── 3. the live channel ───────────────────── */

  describe('the live channel', () => {
    it('pushes a new offer to the rider who was chosen, and only to them', async () => {
      const customer = await registerAndActivateCustomer(app);
      const chosen = await onlineRider({ km: 1 });
      const other = await onlineRider({ km: 30 }); // far away, never offered this round

      const chosenSocket = await connect(chosen.accessToken);
      const otherSocket = await connect(other.accessToken);

      const otherEvents: unknown[] = [];
      otherSocket.on('offer:new', (payload) => otherEvents.push(payload));

      const pushed = waitFor<{ reference: string; deliveryId: string; netFormatted: string }>(
        chosenSocket,
        'offer:new',
      );
      const delivery = await book(customer.accessToken);

      const offer = await pushed;
      expect(offer.deliveryId).toBe(delivery.id);
      expect(offer.reference).toBe(delivery.reference);
      expect(offer.netFormatted).toMatch(/^₦/);

      // The rider who was not offered it receives nothing at all.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(otherEvents).toHaveLength(0);
    });

    it('withdraws the offer from the losing riders the moment somebody accepts', async () => {
      const customer = await registerAndActivateCustomer(app);
      const winner = await onlineRider({ km: 1 });
      const loser = await onlineRider({ km: 2 });

      const loserSocket = await connect(loser.accessToken);
      const revocation = waitFor<{ reason: string; deliveryId: string }>(loserSocket, 'offer:revoked');

      const delivery = await book(customer.accessToken);
      const offers = await offersFor(delivery.id);
      const winningOffer = offers.find((offer) => offer.riderId === winner.riderId)!;

      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${winningOffer.id}/accept`)
        .set({ Authorization: `Bearer ${winner.accessToken}` })
        .expect(201);

      const revoked = await revocation;
      expect(revoked.deliveryId).toBe(delivery.id);
      expect(revoked.reason).toBe('TAKEN');

      // And the database agrees: the losing offer is no longer open.
      const losing = await prisma.deliveryAssignment.findUniqueOrThrow({ where: { id: offers.find((offer) => offer.riderId === loser.riderId)!.id } });
      expect(losing.status).toBe('EXPIRED');
    });

    it('refuses a socket without a token and tells the client why', async () => {
      const socket = io(`${baseUrl}/live`, { transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(socket);

      const error = await waitFor<{ code: string }>(socket, 'error:api');
      expect(error.code).toBe('UNAUTHORIZED');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(socket.connected).toBe(false);
    });

    it('will not let a customer watch somebody else’s delivery', async () => {
      const owner = await registerAndActivateCustomer(app);
      const nosy = await registerAndActivateCustomer(app);
      const delivery = await book(owner.accessToken);

      const socket = await connect(nosy.accessToken);
      const denied = await socket.emitWithAck('subscribe:delivery', { deliveryId: delivery.id });
      expect(denied).toMatchObject({ ok: false, error: 'FORBIDDEN' });

      const own = await socket.emitWithAck('subscribe:delivery', { deliveryId: delivery.id });
      expect(own).toMatchObject({ ok: false, error: 'FORBIDDEN' });

      const ownerSocket = await connect(owner.accessToken);
      const allowed = await ownerSocket.emitWithAck('subscribe:delivery', { deliveryId: delivery.id });
      expect(allowed).toMatchObject({ ok: true });
    });

    it('keeps dispatch traffic away from riders and customers', async () => {
      const customer = await registerAndActivateCustomer(app);
      const rider = await onlineRider({ km: 40 }); // too far to be offered anything

      const riderSocket = await connect(rider.accessToken);
      const customerSocket = await connect(customer.accessToken);

      const riderSaw: unknown[] = [];
      const customerSaw: unknown[] = [];
      riderSocket.on('delivery:new', (payload) => riderSaw.push(payload));
      customerSocket.on('delivery:new', (payload) => customerSaw.push(payload));

      await book(customer.accessToken);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(riderSaw).toHaveLength(0);
      expect(customerSaw).toHaveLength(0);
    });

    it('closes the socket when the session is signed out everywhere', async () => {
      const customer = await registerAndActivateCustomer(app);
      const socket = await connect(customer.accessToken);

      const revoked = waitFor<{ reason: string }>(socket, 'session:revoked');

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set({ Authorization: `Bearer ${customer.accessToken}` })
        .expect(201);

      const event = await revoked;
      expect(event.reason).toMatch(/signed out/i);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(socket.connected).toBe(false);
    });
  });

  /* ─────────────── 4. the engine and the rest of the system ─────────────── */

  describe('the engine and the rest of the system', () => {
    it('offers waiting work again the moment a rider comes online', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      expect(await offersFor(delivery.id)).toHaveLength(0); // nobody was online

      // Documents are uploaded but the rider is still OFFLINE: going online is the
      // action being tested, and the engine must react to it.
      const rider = await createApprovedRider(prisma, passwords, app);
      await prisma.rider.update({ where: { id: rider.riderId }, data: { availability: 'OFFLINE' } });
      await prisma.riderLocation.create({
        data: { riderId: rider.riderId, lat: kmNorth(1), lng: PICKUP.lng },
      });

      await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set({ Authorization: `Bearer ${rider.accessToken}` })
        .send({ availability: 'ONLINE' })
        .expect(201);

      const offers = await offersFor(delivery.id);
      expect(offers).toHaveLength(1);
      expect(offers[0]!.riderId).toBe(rider.riderId);
    });

    it('never offers a job to a rider who is busy, suspended or at their limit', async () => {
      const customer = await registerAndActivateCustomer(app);

      const suspended = await onlineRider({ km: 1 });
      await prisma.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } });

      const unapproved = await onlineRider({ km: 2 });
      await prisma.rider.update({ where: { id: unapproved.riderId }, data: { approvalStatus: 'PENDING' } });

      const busy = await onlineRider({ km: 3 });
      await prisma.rider.update({ where: { id: busy.riderId }, data: { availability: 'ON_DELIVERY' } });

      const eligible = await onlineRider({ km: 4 });

      const delivery = await book(customer.accessToken);
      const offers = await offersFor(delivery.id);

      expect(offers).toHaveLength(1);
      expect(offers[0]!.riderId).toBe(eligible.riderId);
      expect(offers[0]!.rank).toBe(1);
    });
  });

    it('does not restart an exhausted delivery when a rider comes free', async () => {
      const customer = await registerAndActivateCustomer(app);

      // Nobody is online, so every round is empty until the schedule is spent.
      const delivery = await book(customer.accessToken);
      for (let round = 0; round < 6; round += 1) await dispatch.tick(25);

      const before = await prisma.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: { dispatchRound: true },
      });
      expect(before.dispatchRound).toBeGreaterThanOrEqual(4);

      // A rider finishes elsewhere and appears; the post-completion sweep must not
      // resurrect a job the desk has already been told about.
      const rider = await onlineRider({ km: 1 });
      await dispatch.offerWaitingDeliveries(10);

      const offers = await offersFor(delivery.id);
      expect(offers.filter((offer) => offer.riderId === rider.riderId)).toHaveLength(0);
    });

  /* ─────────────────── 5. the dispatch board (the fallback) ─────────────────── */

  describe('the dispatch board', () => {
    const staffLogin = async (roleKeys: string[]) => {
      const staff = await createStaff(prisma, passwords, roleKeys);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
        .expect(201);
      return { ...staff, accessToken: login.body.accessToken as string };
    };

    it('shows every waiting booking with how far the search has widened and who was asked', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const admin = await staffLogin(['SUPER_ADMIN']);

      const board = await request(app.getHttpServer())
        .get('/api/v1/admin/dispatch/board')
        .set({ Authorization: `Bearer ${admin.accessToken}` })
        .expect(200);

      const row = (board.body.waiting as { id: string }[]).find((item) => item.id === delivery.id);
      expect(row).toBeDefined();
      const waiting = row as unknown as {
        dispatch: { round: number; radiusLabel: string; offersOut: number; askedCount: number; exhausted: boolean };
      };
      // Booking ran round 1 and found nobody online — that empty round still counts,
      // so the board shows the search already widened to round 2 (20 km).
      expect(waiting.dispatch.round).toBe(2);
      expect(waiting.dispatch.radiusLabel).toBe('20 km');
      expect(waiting.dispatch.offersOut).toBe(0);
      expect(waiting.dispatch.exhausted).toBe(false);
      expect(board.body.summary.batchSize).toBeGreaterThan(0);
    });

    it('lets the desk run the next round immediately, and refuses to double-offer', async () => {
      const admin = await staffLogin(['SUPER_ADMIN']);
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);

      // A rider appears after the booking was made and the first round found nobody.
      const rider = await onlineRider({ km: 2 });

      const first = await request(app.getHttpServer())
        .post(`/api/v1/admin/dispatch/deliveries/${delivery.id}/run`)
        .set({ Authorization: `Bearer ${admin.accessToken}` })
        .expect(201);
      expect(first.body.offered).toBe(1);
      // The booking's own round 1 found nobody; this is the widened second round.
      expect(first.body.round).toBe(2);

      const offers = await offersFor(delivery.id);
      expect(offers).toHaveLength(1);
      expect(offers[0]!.riderId).toBe(rider.riderId);

      // Pressing it again while the rider is still deciding must change nothing.
      const second = await request(app.getHttpServer())
        .post(`/api/v1/admin/dispatch/deliveries/${delivery.id}/run`)
        .set({ Authorization: `Bearer ${admin.accessToken}` })
        .expect(409);
      expect(second.body.error.code).toBe('CONFLICT');
      expect(await offersFor(delivery.id)).toHaveLength(1);
    });

    it('refuses to run a round for a delivery that already has a rider', async () => {
      const admin = await staffLogin(['SUPER_ADMIN']);
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await onlineRider({ km: 2 });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/dispatch/deliveries/${delivery.id}/run`)
        .set({ Authorization: `Bearer ${admin.accessToken}` })
        .expect(201);

      // The rider accepts; the delivery is no longer waiting for anyone.
      const offers = await offersFor(delivery.id);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${offers[0]!.id}/accept`)
        .set({ Authorization: `Bearer ${rider.accessToken}` })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/dispatch/deliveries/${delivery.id}/run`)
        .set({ Authorization: `Bearer ${admin.accessToken}` })
        .expect(409);
      expect(res.body.error.message).toMatch(/no longer waiting/i);
    });

    it('keeps the board readable for support and unactionable for them', async () => {
      const support = await staffLogin(['SUPPORT_AGENT']);
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);

      await request(app.getHttpServer())
        .get('/api/v1/admin/dispatch/board')
        .set({ Authorization: `Bearer ${support.accessToken}` })
        .expect(200);

      // Running a round changes who is offered work: that is an assignment right.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/dispatch/deliveries/${delivery.id}/run`)
        .set({ Authorization: `Bearer ${support.accessToken}` })
        .expect(403);
    });

    it('is closed to customers and riders', async () => {
      const customer = await registerAndActivateCustomer(app);
      await request(app.getHttpServer())
        .get('/api/v1/admin/dispatch/board')
        .set({ Authorization: `Bearer ${customer.accessToken}` })
        .expect(403);

      const rider = await onlineRider({ km: 1 });
      await request(app.getHttpServer())
        .get('/api/v1/admin/dispatch/board')
        .set({ Authorization: `Bearer ${rider.accessToken}` })
        .expect(403);
    });
  });
});
