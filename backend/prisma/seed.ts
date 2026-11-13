// Load backend/.env explicitly.
//
// `tsx` does not read .env on its own, so running the seed from a fresh shell
// failed with "Environment variable not found: DATABASE_URL" — the API worked
// because Nest's ConfigModule loads the file. Loading it here makes the seed
// behave identically however it is invoked (npm script, CI, docker entrypoint).
import 'dotenv/config';

/**
 * DATABASE SEED — run with:  npm run db:seed
 *
 * Idempotent: every write is an upsert, so running it twice changes nothing
 * and creates no duplicates. It seeds CONFIGURATION ONLY (roles, permissions,
 * ledger accounts, zones, pricing, settings, one super admin, FAQs).
 *
 * It deliberately does NOT create fake customers, riders, deliveries or revenue.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { PERMISSIONS, ROLE_KEYS, ROLE_PERMISSIONS } from '@dispatch/shared';
import { BRANCHES, COMPANY, SUPER_ADMIN } from './seed-data/company';
import { DEFAULT_PRICING, SERVICE_ZONES } from './seed-data/zones';
import { FAQS, LEDGER_ACCOUNTS, SYSTEM_SETTINGS } from './seed-data/ledger';

const prisma = new PrismaClient();

const ROLE_NAMES: Record<(typeof ROLE_KEYS)[number], string> = {
  SUPER_ADMIN: 'Super Administrator',
  OPERATIONS_MANAGER: 'Operations Manager',
  FINANCE_MANAGER: 'Finance Manager',
  RIDER_MANAGER: 'Rider Manager',
  SUPPORT_AGENT: 'Customer Support Agent',
};

async function seedPermissionsAndRoles() {
  for (const key of PERMISSIONS) {
    const [group] = key.split(':');
    await prisma.permission.upsert({
      where: { key },
      update: { group: group!, description: key },
      create: { key, group: group!, description: key },
    });
  }

  for (const roleKey of ROLE_KEYS) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: ROLE_NAMES[roleKey] },
      create: { key: roleKey, name: ROLE_NAMES[roleKey], isSystem: true },
    });

    const granted = ROLE_PERMISSIONS[roleKey];
    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...granted] } },
      select: { id: true },
    });

    // Reset the grants so the seed file is the source of truth on every run.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    console.log(`   role ${roleKey.padEnd(19)} ${permissions.length} permissions`);
  }
}

async function seedOrganisation() {
  for (const branch of BRANCHES) {
    const created = await prisma.branch.upsert({
      where: { code: branch.code },
      update: { ...branch },
      create: { ...branch },
    });
    console.log(`   branch ${created.code} — ${created.name}`);

    for (const zone of SERVICE_ZONES) {
      await prisma.serviceZone.upsert({
        where: { branchId_code: { branchId: created.id, code: zone.code } },
        update: { ...zone, branchId: created.id },
        create: { ...zone, branchId: created.id },
      });
    }
    console.log(`   zones  ${SERVICE_ZONES.map((z) => z.code).join(', ')}`);

    // Zones that used to exist and no longer appear in the config are switched off
    // rather than deleted. Historical deliveries point at them, and a zone that
    // vanishes takes its reporting with it.
    const retiredZones = await prisma.serviceZone.updateMany({
      where: { branchId: created.id, code: { notIn: SERVICE_ZONES.map((z) => z.code) } },
      data: { isActive: false },
    });
    if (retiredZones.count > 0) {
      console.log(`   zones  ${retiredZones.count} retired (no longer in config)`);
    }

    // Exactly one active default pricing rule per branch.
    const existingRule = await prisma.pricingRule.findFirst({
      where: { branchId: created.id, serviceZoneId: null, isActive: true },
    });
    if (!existingRule) {
      await prisma.pricingRule.create({
        data: {
          branchId: created.id,
          name: DEFAULT_PRICING.name,
          isActive: true,
          effectiveFrom: new Date(),
          baseFeeKobo: DEFAULT_PRICING.baseFeeKobo,
          perKmFeeKobo: DEFAULT_PRICING.perKmFeeKobo,
          minFeeKobo: DEFAULT_PRICING.minFeeKobo,
          freeKmIncluded: DEFAULT_PRICING.freeKmIncluded,
          expressSurchargeKobo: DEFAULT_PRICING.expressSurchargeKobo,
          scheduledSurchargeKobo: DEFAULT_PRICING.scheduledSurchargeKobo,
          sameDaySurchargeKobo: DEFAULT_PRICING.sameDaySurchargeKobo,
          waitingFeePerMinKobo: DEFAULT_PRICING.waitingFeePerMinKobo,
          additionalStopFeeKobo: DEFAULT_PRICING.additionalStopFeeKobo,
          defaultCommissionPct: DEFAULT_PRICING.defaultCommissionPct,
          roundToKobo: DEFAULT_PRICING.roundToKobo,
        },
      });
      console.log(`   pricing rule "${DEFAULT_PRICING.name}" activated`);
    }
  }

  // Same rule for branches: anything the config no longer names is switched off.
  // New accounts are only ever attached to an active branch.
  const retiredBranches = await prisma.branch.updateMany({
    where: { code: { notIn: BRANCHES.map((b) => b.code) } },
    data: { isActive: false },
  });
  if (retiredBranches.count > 0) {
    console.log(`   branches ${retiredBranches.count} retired (no longer in config)`);
  }
}

async function seedLedgerAndSettings() {
  for (const account of LEDGER_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      update: { name: account.name, type: account.type, normalBalance: account.normalBalance },
      create: { ...account, isSystem: true },
    });
  }
  console.log(`   ${LEDGER_ACCOUNTS.length} ledger accounts`);

  for (const setting of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { group: setting.group, description: setting.description },
      create: {
        key: setting.key,
        valueJson: setting.value as never,
        type: setting.type,
        group: setting.group,
        description: setting.description,
      },
    });
  }
  console.log(`   ${SYSTEM_SETTINGS.length} system settings`);

  for (const [index, faq] of FAQS.entries()) {
    const existing = await prisma.faq.findFirst({ where: { question: faq.question } });
    if (!existing) await prisma.faq.create({ data: { ...faq } });
    void index;
  }
  console.log(`   ${FAQS.length} FAQs`);
}

async function seedSuperAdmin() {
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const passwordHash = await argon2.hash(SUPER_ADMIN.password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: {},
    create: {
      email: SUPER_ADMIN.email,
      phone: SUPER_ADMIN.phone,
      passwordHash,
      type: 'STAFF',
      status: 'ACTIVE',
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      mustChangePassword: true,
    },
  });

  const staff = await prisma.staff.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, staffCode: 'STF-0001', branchId: branch.id, isSuperAdmin: true },
  });

  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  await prisma.staffRole.upsert({
    where: { staffId_roleId: { staffId: staff.id, roleId: superRole.id } },
    update: {},
    create: { staffId: staff.id, roleId: superRole.id },
  });

  // Every user gets a wallet (customer credit / rider earnings).
  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, type: 'COMPANY', balanceKobo: 0n },
  });

  console.log(`   super admin ${SUPER_ADMIN.email} (password printed below)`);
  return { email: SUPER_ADMIN.email, password: SUPER_ADMIN.password };
}

async function main() {
  console.log(`\n🌱 Seeding ${COMPANY.name}…\n`);
  console.log('▶ Roles & permissions');
  await seedPermissionsAndRoles();
  console.log('▶ Organisation, zones & pricing');
  await seedOrganisation();
  console.log('▶ Ledger, settings & FAQs');
  await seedLedgerAndSettings();
  console.log('▶ Super administrator');
  const admin = await seedSuperAdmin();

  console.log(`
✅ Seed complete.

   Sign in to the ADMIN portal with:
     email    : ${admin.email}
     password : ${admin.password}
   ⚠ This password is shown once. Change it immediately after first login.

   No fake customers, riders, deliveries or revenue were created —
   every dashboard figure you see will come from real activity.
`);
}

main()
  .catch((error) => {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
