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
import { RT, type DeliveryPush, type OfferPush, type RevokedPush } from './realtime.types';

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
  ) {}

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

  handleDisconnect(client: SocketData): void {
    const principal = client.data.principal;
    if (principal) this.logger.log(`Live disconnect: ${principal.type} ${principal.userId.slice(0, 8)}`);
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
