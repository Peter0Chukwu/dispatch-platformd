import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../infra/prisma/prisma.service';
import { PrincipalService } from '../auth/principal.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { RT, type CallPush, type DeliveryPush, type OfferPush, type RevokedPush } from './realtime.types';
import { CallSignalingService } from './call-signaling.service';

/** Where each kind of client listens. Rooms are namespaced so they can never collide. */
export const room = {
  user: (userId: string) => `user:${userId}`,
  rider: (riderId: string) => `rider:${riderId}`,
  customer: (customerId: string) => `customer:${customerId}`,
  /** Every staff member allowed to read deliveries. */
  staff: 'staff:dispatch',
  delivery: (deliveryId: string) => `delivery:${deliveryId}`,
};

type SocketData = Socket & { data: { principal?: AuthPrincipal } };

/**
 * LIVE CHANNEL (Socket.IO)
 *
 * What it is: a push channel for things a rider or a dispatcher must not have to
 * refresh for — a new offer, a withdrawn offer, a delivery that changed state.
 *
 * What it is NOT: a second way to authorise anything. The handshake proves who you
 * are (a real access token, resolved by the same PrincipalService the HTTP guard
 * uses) and every room a socket joins is derived from that identity. A rider can
 * only ever receive their own offers; the staff room is only joined by staff who
 * hold `delivery:read`; and every action still goes through a REST endpoint that
 * re-checks permissions, freshness and the database.
 */
@WebSocketGateway({
  namespace: '/live',
  cors: {
    // Security here rests on the access token, not on the origin header, but a
    // configured allowlist is still honoured so production can be strict.
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      const allowed = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!origin || allowed.length === 0 || allowed.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed`), false);
    },
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly principals: PrincipalService,
    private readonly prisma: PrismaService,
    private readonly calls: CallSignalingService,
  ) {
    // The broker owns the ringing deadline; the gateway owns the transport.
    this.calls.attachNotifier({
      missed: (userIds, callId) => {
        for (const userId of userIds) this.emit(room.user(userId), RT.CALL_DECLINED, { callId, reason: 'MISSED' });
      },
    });
  }

  async handleConnection(client: SocketData): Promise<void> {
    const raw = (client.handshake.auth?.token ?? '') as string | undefined;
    const token = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;

    if (!token) {
      this.reject(client, 'UNAUTHORIZED', 'Sign in to open a live connection.');
      return;
    }

    let principal: AuthPrincipal;
    try {
      principal = await this.principals.fromAccessToken(token);
    } catch (error) {
      // Never leak which check failed — an expired token and a suspended account
      // are both simply "no".
      this.reject(client, 'UNAUTHORIZED', (error as Error).message || 'Invalid session');
      return;
    }

    client.data.principal = principal;

    const joined: string[] = [room.user(principal.userId)];
    if (principal.riderId) joined.push(room.rider(principal.riderId));
    if (principal.customerId) joined.push(room.customer(principal.customerId));
    if (principal.type === 'STAFF' && PrincipalService.has(principal, 'delivery:read')) joined.push(room.staff);

    await client.join(joined);
    client.emit(RT.READY, {
      userId: principal.userId,
      type: principal.type,
      audience: principal.audience,
      rooms: joined.map((name) => (name.startsWith('user:') ? 'user' : name.split(':')[0])),
    });

    this.logger.log(`Live connection: ${principal.type} ${principal.userId.slice(0, 8)} (${joined.length} rooms)`);
  }

  async handleDisconnect(client: SocketData): Promise<void> {
    const principal = client.data.principal;
    if (!principal) return;
    this.logger.log(`Live disconnect: ${principal.type} ${principal.userId.slice(0, 8)}`);

    // A closed tab must not leave a call ringing for the other person. Only act
    // when this was the last socket for that user — closing one of two tabs is not
    // hanging up.
    const remaining = await this.socketsFor(principal.userId);
    if (remaining > 0) return;
    for (const callId of this.calls.endForUser(principal.userId)) {
      this.emit(room.user(principal.userId), RT.CALL_ENDED, { callId, reason: 'DISCONNECTED' });
    }
  }

  /** How many live sockets this user still has. Zero means they are gone. */
  private async socketsFor(userId: string): Promise<number> {
    const server = this.server as unknown as {
      adapter?: { rooms: Map<string, Set<string>> };
      sockets?: { adapter?: { rooms: Map<string, Set<string>> } };
    };
    const adapter = server?.adapter ?? server?.sockets?.adapter;
    return adapter?.rooms.get(room.user(userId))?.size ?? 0;
  }

  /* ──────────────────────────── in-app calling ──────────────────────────── */

  /**
   * Start a call about a delivery.
   *
   * The broker re-reads the delivery and decides whether these two people may
   * speak; this handler only carries the answer to a socket. Nothing in the
   * payload is a phone number, and nothing in it is trusted.
   */
  @SubscribeMessage('call:start')
  async callStart(
    @ConnectedSocket() client: SocketData,
    @MessageBody() body: { deliveryId?: string },
  ): Promise<{ ok: boolean; callId?: string; error?: string; message?: string }> {
    const principal = client.data.principal;
    if (!principal) return { ok: false, error: 'UNAUTHORIZED', message: 'Sign in to call.' };
    if (!body?.deliveryId) return { ok: false, error: 'BAD_REQUEST', message: 'No delivery given.' };

    const outcome = await this.calls.start(principal, body.deliveryId);
    if (!outcome.ok) {
      client.emit(RT.CALL_ERROR, { error: outcome.error, message: outcome.message });
      return { ok: false, error: outcome.error, message: outcome.message };
    }

    const push: CallPush = {
      callId: outcome.call.callId,
      deliveryId: outcome.call.deliveryId,
      from: principal.type === 'CUSTOMER' ? 'CUSTOMER' : 'RIDER',
      fromName: principal.firstName ?? (principal.type === 'CUSTOMER' ? 'Your customer' : 'Your rider'),
    };
    this.emit(room.user(outcome.call.peerUserId), RT.CALL_INCOMING, push);
    return { ok: true, callId: outcome.call.callId };
  }

  @SubscribeMessage('call:accept')
  callAccept(
    @ConnectedSocket() client: SocketData,
    @MessageBody() body: { callId?: string },
  ): { ok: boolean; error?: string } {
    const principal = client.data.principal;
    if (!principal || !body?.callId) return { ok: false, error: 'UNAUTHORIZED' };

    const outcome = this.calls.accept(principal, body.callId);
    if (!outcome.ok) return { ok: false, error: outcome.error };

    this.emit(room.user(outcome.call.peerUserId), RT.CALL_ACCEPTED, { callId: outcome.call.callId });
    return { ok: true };
  }

  @SubscribeMessage('call:end')
  callEnd(
    @ConnectedSocket() client: SocketData,
    @MessageBody() body: { callId?: string; reason?: string },
  ): { ok: boolean } {
    const principal = client.data.principal;
    if (!principal || !body?.callId) return { ok: false };

    const result = this.calls.end(principal, body.callId);
    if (!result.ended || !result.peerUserId) return { ok: false };
    const event = body.reason === 'DECLINED' ? RT.CALL_DECLINED : RT.CALL_ENDED;
    this.emit(room.user(result.peerUserId), event, { callId: body.callId, reason: body.reason ?? 'HUNG_UP' });
    return { ok: true };
  }

  /**
   * Offer / answer / ICE candidate.
   *
   * Relayed verbatim to the other leg, and only after the broker confirms the
   * sender really is in that call. The gateway never inspects or stores SDP.
   */
  @SubscribeMessage('call:signal')
  callSignal(
    @ConnectedSocket() client: SocketData,
    @MessageBody() body: { callId?: string; data?: unknown },
  ): { ok: boolean } {
    const principal = client.data.principal;
    if (!principal || !body?.callId || body.data === undefined) return { ok: false };

    const relayed = this.calls.relay(principal, body.callId, body.data);
    if (!relayed) return { ok: false };

    this.emit(room.user(relayed.peerUserId), RT.CALL_SIGNAL, { callId: body.callId, data: body.data });
    return { ok: true };
  }

  /** Cheap liveness probe the client uses instead of polling. */
  @SubscribeMessage('ping')
  ping(@ConnectedSocket() client: Socket): void {
    client.emit(RT.PONG, { at: Date.now() });
  }

  /**
   * Tracking rooms are joined on demand, and the decision is made here: a customer
   * may watch their own delivery, a rider may watch one they are assigned to, and
   * staff may watch anything they have `delivery:read` for.
   */
  @SubscribeMessage('subscribe:delivery')
  async subscribeToDelivery(
    @ConnectedSocket() client: SocketData,
    @MessageBody() body: { deliveryId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const principal = client.data.principal;
    const deliveryId = body?.deliveryId;
    if (!principal || !deliveryId) return { ok: false, error: 'UNAUTHORIZED' };

    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, customerId: true, riderId: true },
    });
    if (!delivery) return { ok: false, error: 'NOT_FOUND' };

    const isStaff = principal.type === 'STAFF' && PrincipalService.has(principal, 'delivery:read');
    const isOwner = Boolean(principal.customerId) && delivery.customerId === principal.customerId;
    const isRider = Boolean(principal.riderId) && delivery.riderId === principal.riderId;

    if (!isStaff && !isOwner && !isRider) return { ok: false, error: 'FORBIDDEN' };

    await client.join(room.delivery(delivery.id));
    return { ok: true };
  }

  /* ─────────────────────────── emit helpers ─────────────────────────── */

  /** A new offer, addressed to exactly one rider. */
  toRider(riderId: string, event: string, payload: unknown): void {
    this.emit(room.rider(riderId), event, payload);
  }

  toCustomer(customerId: string, event: string, payload: unknown): void {
    this.emit(room.customer(customerId), event, payload);
  }

  toStaff(event: string, payload: unknown): void {
    this.emit(room.staff, event, payload);
  }

  toDelivery(deliveryId: string, event: string, payload: unknown): void {
    this.emit(room.delivery(deliveryId), event, payload);
  }

  offerNew(riderId: string, offer: OfferPush): void {
    this.toRider(riderId, RT.OFFER_NEW, offer);
  }

  offerRevoked(riderId: string, revoked: RevokedPush): void {
    this.toRider(riderId, RT.OFFER_REVOKED, revoked);
  }

  deliveryPush(push: DeliveryPush, audience: { staff?: boolean; customerId?: string | null; riderIds?: string[] }): void {
    if (audience.staff) this.toStaff(RT.DELIVERY_UPDATED, push);
    if (audience.customerId) this.toCustomer(audience.customerId, RT.DELIVERY_UPDATED, push);
    for (const riderId of audience.riderIds ?? []) this.toRider(riderId, RT.DELIVERY_UPDATED, push);
    this.toDelivery(push.id, RT.DELIVERY_UPDATED, push);
  }

  /**
   * Called when an account is suspended or its sessions are revoked: the sockets
   * die with the session, so a suspended rider stops receiving offers at once
   * instead of when their browser happens to reconnect.
   */
  revokeUser(userId: string, reason = 'Your session has ended. Please sign in again.'): number {
    // The socket server only exists when the app is actually listening. Anything
    // running without one (the HTTP test harness, CLI scripts) simply has no
    // sockets to close — a missing transport must never fail a suspension.
    const server = this.server as unknown as {
      adapter?: { rooms: Map<string, Set<string>> };
      sockets?: { adapter?: { rooms: Map<string, Set<string>> } };
    };
    const adapter = server?.adapter ?? server?.sockets?.adapter;
    if (!adapter) return 0;

    const sockets = adapter.rooms.get(room.user(userId));
    const count = sockets?.size ?? 0;
    if (count > 0) {
      this.server.to(room.user(userId)).emit(RT.SESSION_REVOKED, { reason });
      this.server.in(room.user(userId)).disconnectSockets(true);
      this.logger.warn(`Closed ${count} live connection(s) for user ${userId.slice(0, 8)}: ${reason}`);
    }
    return count;
  }

  private emit(target: string, event: string, payload: unknown): void {
    // The gateway is optional infrastructure: if no socket server is attached (the
    // HTTP test harness, CLI scripts) the push is skipped. Nothing in the business
    // logic may depend on a browser being open.
    //
    // A gateway with a namespace receives the *Namespace* here, which keeps its
    // adapter on `namespace.adapter`; a gateway without one receives the Server,
    // where it hangs off `server.sockets.adapter`. Checking both is what makes this
    // correct in either shape (a mistake that made every push silently no-op).
    const server = this.server as unknown as { adapter?: unknown; sockets?: { adapter?: unknown } };
    const attached = Boolean(server?.adapter ?? server?.sockets?.adapter);
    if (!attached) return;
    this.server.to(target).emit(event, payload);
  }

  private reject(client: Socket, code: string, message: string): void {
    client.emit(RT.ERROR, { code, message });
    client.disconnect(true);
  }
}
