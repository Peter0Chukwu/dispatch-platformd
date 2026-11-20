import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/messaging/chat.service';
import type { AuthPrincipal } from '../src/auth/auth.types';

/**
 * Unread counts — the number behind the badge on a delivery.
 *
 * The badge is the whole reason someone notices a message without an inbox screen,
 * so the rules matter: count the other side's messages, count them per delivery,
 * never mark anything read just by asking, and never count a message twice.
 */

const customer = {
  userId: 'u-cust',
  type: 'CUSTOMER',
  audience: 'CUSTOMER',
  customerId: 'cust-1',
  roles: [],
  permissions: [],
} as unknown as AuthPrincipal;

const rider = {
  userId: 'u-rider',
  type: 'RIDER',
  audience: 'RIDER',
  riderId: 'rid-1',
  roles: [],
  permissions: [],
} as unknown as AuthPrincipal;

function service(rows: unknown[]) {
  const groupBy = vi.fn(async (_args: { where?: Record<string, unknown> }) => rows);
  const updateMany = vi.fn(async () => ({ count: 0 }));
  const prisma = { message: { groupBy, updateMany } };
  return { chat: new ChatService(prisma as never, {} as never), groupBy, updateMany };
}

describe('phase 7 — unread messages', () => {
  it('counts the other side per delivery and gives a total', async () => {
    const { chat, groupBy } = service([
      { deliveryId: 'del-1', _count: { _all: 2 }, _max: { createdAt: new Date('2026-11-04T09:00:00Z') } },
      { deliveryId: 'del-2', _count: { _all: 1 }, _max: { createdAt: new Date('2026-11-04T10:00:00Z') } },
    ]);

    const result = await chat.unread(customer);

    expect(result.total).toBe(3);
    expect(result.byDelivery.map((row) => row.deliveryId)).toEqual(['del-1', 'del-2']);

    // Only messages the customer did not write, only ones not yet read, and only
    // deliveries that are theirs.
    const where = groupBy.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      readAt: null,
      senderType: { not: 'CUSTOMER' },
      delivery: { customerId: 'cust-1' },
    });
  });

  it('asks the other question for a rider', async () => {
    const { chat, groupBy } = service([]);

    await chat.unread(rider);

    expect(groupBy.mock.calls[0]?.[0]?.where).toMatchObject({
      senderType: { not: 'RIDER' },
      delivery: { riderId: 'rid-1' },
    });
  });

  it('never marks anything read — reading is what does that', async () => {
    const { chat, updateMany } = service([]);

    await chat.unread(customer);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('says zero for an account with no customer or rider record', async () => {
    const { chat, groupBy } = service([]);
    const orphan = { ...customer, customerId: undefined } as unknown as AuthPrincipal;

    await expect(chat.unread(orphan)).resolves.toEqual({ total: 0, byDelivery: [] });
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('refuses staff, who are parties to nobody’s conversation', async () => {
    const { chat } = service([]);
    const staff = { ...customer, type: 'STAFF', customerId: undefined } as unknown as AuthPrincipal;

    await expect(chat.unread(staff)).rejects.toThrow();
  });
});
