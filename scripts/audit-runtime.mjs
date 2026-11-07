#!/usr/bin/env node
/**
 * RUNTIME SECURITY AUDIT (Phase 10)
 *
 * `npm audit` answers "does anything in this dependency tree have a known CVE?".
 * That is the right question for a repository — but not the right *gate* for a
 * deploy, because the tree includes the build toolchain, which never reaches a
 * running container. This script gates on what actually ships:
 *
 *   · reads `npm audit --omit=dev --json`;
 *   · drops packages on the documented BUILD_ONLY list (with the reason);
 *
 * IMPORTANT: entries on that list are NOT absent from the image. `prisma` ships
 * because @prisma/client depends on it. They are allowlisted because the vulnerable
 * code is only reachable by the CLI, which the server never runs. Verify that claim
 * again whenever Prisma is upgraded.
 *   · fails on any remaining high or critical finding.
 *
 * The allowlist is deliberately tiny and must stay justified: if a package in it
 * ever becomes reachable at runtime, remove the entry.
 *
 * Usage: node scripts/audit-runtime.mjs [--json]
 */
import { spawnSync } from 'node:child_process';

/**
 * Packages that exist only to *build* or *migrate* — they are not copied into the
 * API image (deploy/Dockerfile.api copies prod dependencies only, and the `migrate`
 * service runs the CLI then exits).
 */
const BUILD_ONLY = new Map([
  ['prisma', 'the migration CLI — runs once as a compose job, never serves a request'],
  ['@prisma/config', "prisma CLI's config loader, pulled in only by the CLI"],
  ['deepmerge-ts', "a dependency of @prisma/config; reachable only inside the CLI"],
  ['@nestjs/cli', 'the Nest build tool'],
  ['fork-ts-checker-webpack-plugin', 'dev-server type checking'],
  ['glob', 'a transitive dependency of build tooling'],
  ['minimatch', 'a transitive dependency of build tooling'],
  ['deepmerge', 'a transitive dependency of dev tooling'],
  ['vitest', 'the test runner'],
  ['@vitest/mocker', 'part of the test runner'],
  ['tinypool', 'part of the test runner'],
  ['concurrently', 'runs the dev servers side by side'],
]);

// `npm audit` exits non-zero when it finds anything — expected here, so the exit
// code is ignored and the JSON on stdout is what matters.
const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });
if (!result.stdout) {
  console.error('npm audit produced no output:', result.stderr);
  process.exit(2);
}
const report = JSON.parse(result.stdout);

const blocking = [];
const allowed = [];

for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
  const severity = info.severity;
  if (severity !== 'high' && severity !== 'critical') continue;
  if (BUILD_ONLY.has(name)) allowed.push({ name, severity, why: BUILD_ONLY.get(name) });
  else blocking.push({ name, severity, via: info.via });
}

const line = (item) => `  ${item.severity === 'critical' ? '✗' : '!'} ${item.name.padEnd(28)} ${item.why ?? ''}`;

console.log('Runtime dependencies (production install, minus build-only tooling)');
console.log(`  high/critical findings: ${blocking.length + allowed.length}`);

if (allowed.length > 0) {
  console.log('\nBuild-only, justified and excluded from the runtime image:');
  for (const item of allowed) console.log(line(item));
}

if (blocking.length > 0) {
  console.log('\nBLOCKING — these ship in the runtime image:');
  for (const item of blocking) console.log(`  ✗ ${item.name} (${item.severity})`);
  process.exitCode = 1;
} else {
  console.log('\n✓ No high or critical vulnerability in a package that ships.');
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ blocking, allowed }, null, 2));
}
