import { Injectable } from '@nestjs/common';
import { CHAT_OPEN_STATUSES } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import type { AuthPrincipal } from '../auth/auth.types';

export interface ChatMessageDto {
  id: string;
  deliveryId: string;
  senderType: 'CUSTOMER' | 'RIDER';
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * CHAT BETWEEN THE TWO PEOPLE ON A DELIVERY
 *
 * The rules, all decided here rather than in a screen:
 *
 *  1. Only the customer who booked and the rider carrying it can read or write —
 *     anyone else gets NOT FOUND, so a delivery id cannot be used to probe.
 *  2. Writing is only allowed while the delivery is live. After it ends the
 *     thread is evidence: readable, not editable, and not reopenable.
 *  3. A message that looks like a phone number is refused by the shared schema,
 *     which is what makes "your number is never revealed" true in practice.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async resolve(user: AuthPrincipal) {
    // The principal is one of the two parties; which one decides the sender label.
    if (user.type !== 'CUSTOMER' && user.type !== 'RIDER') {
      throw AppError.forbidden('Only the customer and the rider can use this thread');
    }
    return user.type === 'CUSTOMER' ? ('CUSTOMER' as const) : ('RIDER' as const);
  }

  /** Loads the delivery and proves this principal is one of its two parties. */
  private async thread(user: AuthPrincipal, deliveryId: string) {
    const senderType = await this.resolve(user);
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, customerId: true, riderId: true, status: true },
    });
    if (!delivery) throw AppError.notFound('Delivery not found');

    const isCustomer = senderType === 'CUSTOMER' && delivery.customerId === user.customerId;
    const isRider = senderType === 'RIDER' && !!user.riderId && delivery.riderId === user.riderId;
    if (!isCustomer && !isRider) throw AppError.notFound('Delivery not found');

    return { senderType, delivery };
  }

  private toDto(row: {
    id: string;
    deliveryId: string;
    senderType: string;
    body: string;
    createdAt: Date;
    readAt: Date | null;
  }): ChatMessageDto {
    return {
      id: row.id,
      deliveryId: row.deliveryId,
      senderType: row.senderType === 'RIDER' ? 'RIDER' : 'CUSTOMER',
      body: row.body,
      createdAt: row.createdAt,
      readAt: row.readAt,
    };
  }

  /**
   * The whole thread, oldest first, with the other side's unread messages marked
   * read on the way out. Reading is what marks them read: there is no separate
   * "seen" call for the client to forget to make.
   */
  async list(user: AuthPrincipal, deliveryId: string): Promise<{ messages: ChatMessageDto[] }> {
    const { senderType, delivery } = await this.thread(user, deliveryId);

    await this.prisma.message.updateMany({
      where: { deliveryId: delivery.id, senderType: { not: senderType }, readAt: null },
      data: { readAt: new Date() },
    });

    const rows = await this.prisma.message.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, deliveryId: true, senderType: true, body: true, createdAt: true, readAt: true },
    });
    return { messages: rows.map((row) => this.toDto(row)) };
  }

  async send(user: AuthPrincipal, deliveryId: string, input: { body: string }): Promise<ChatMessageDto> {
    const { senderType, delivery } = await this.thread(user, deliveryId);

    if (!(CHAT_OPEN_STATUSES as readonly string[]).includes(delivery.status)) {
      throw AppError.conflict('This delivery has ended — the conversation is closed.');
    }

    const row = await this.prisma.message.create({
      data: {
        deliveryId: delivery.id,
        senderType,
        senderUserId: user.userId,
        body: input.body,
      },
      select: { id: true, deliveryId: true, senderType: true, body: true, createdAt: true, readAt: true },
    });

    const dto = this.toDto(row);
    // Two audiences: the delivery room (anyone watching this trip) and the two
    // personal rooms, which every signed-in client joins at handshake — so the
    // message arrives even if nobody opened the chat panel yet.
    this.realtime.toDelivery(delivery.id, RT.MESSAGE_NEW, dto);
    if (delivery.customerId) this.realtime.toCustomer(delivery.customerId, RT.MESSAGE_NEW, dto);
    if (delivery.riderId) this.realtime.toRider(delivery.riderId, RT.MESSAGE_NEW, dto);

    return dto;
  }
}
