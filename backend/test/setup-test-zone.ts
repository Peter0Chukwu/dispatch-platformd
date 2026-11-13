/**
 * TEST-ONLY FIXTURE — not part of the application.
 *
 * The integration suites were written against Lagos coordinates (Victoria Island
 * to Surulere and so on). The company now operates from Benin City, so those
 * points sit ~300 km outside every real service zone and pricing would rightly
 * refuse them. Rather than rewrite 43 coordinates across 18 spec files — and risk
 * changing what the assertions mean — the test database gets one extra zone that
 * covers the fixture area. Production seed data is untouched: this file is only
 * ever executed by test/global-setup.ts against dispatch_dev_test.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new Error('No active branch — did the seed run?');

  await prisma.serviceZone.upsert({
    where: { branchId_code: { branchId: branch.id, code: 'TEST-FIXTURE-LAGOS' } },
    create: {
      branchId: branch.id,
      code: 'TEST-FIXTURE-LAGOS',
      name: 'Test fixture area (not a real zone)',
      centerLat: 6.455,
      centerLng: 3.396,
      radiusKm: 40,
      baseFeeKobo: 150000n,
      perKmFeeKobo: 12000n,
      minFeeKobo: 150000n,
      supportsSameDay: true,
    },
    update: { isActive: true },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
