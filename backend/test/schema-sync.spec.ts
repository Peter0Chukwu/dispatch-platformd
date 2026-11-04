import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  DeliveryStatus,
  DeliveryType,
  PaymentProvider,
  UserType,
  VehicleType,
  WithdrawalStatus,
} from '@dispatch/shared';

/**
 * Guards the seam between Prisma's generated enums and the shared enums that the
 * three portals import. If someone adds a value in schema.prisma and forgets the
 * shared package (or vice-versa), this test fails immediately instead of
 * producing a mysterious runtime mismatch in production.
 */
function prismaEnum(name: string): string[] {
  const found = Prisma.dmmf.datamodel.enums.find((e) => e.name === name);
  if (!found) throw new Error(`Enum ${name} not found in Prisma schema`);
  return found.values.map((v) => v.name).sort();
}

describe('Prisma enums and @dispatch/shared enums stay in sync', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['UserType', UserType],
    ['DeliveryStatus', DeliveryStatus],
    ['DeliveryType', DeliveryType],
    ['VehicleType', VehicleType],
    ['PaymentProvider', PaymentProvider],
    ['WithdrawalStatus', WithdrawalStatus],
  ];

  it.each(cases)('%s matches', (name, sharedEnum) => {
    expect(prismaEnum(name)).toEqual(Object.values(sharedEnum).sort());
  });
});
