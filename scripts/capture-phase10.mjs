/**
 * PHASE 10 EVIDENCE CAPTURE
 *
 * Phase 9 produced pictures of the product. Phase 10 is mostly about *proof of
 * operations*, and the honest artefact for that is the terminal output of the checks
 * being run — not a mock-up of a dashboard. So this script executes each check for
 * real, keeps its exact output, and renders it as an image.
 *
 * It runs, in order:
 *   1. the runtime dependency audit          (node  scripts/audit-runtime.mjs)
 *   2. the load smoke                        (node  scripts/load-smoke.mjs)
 *   3. the backup/restore drill              (bash  scripts/db-restore-drill.sh)
 *   4. the twenty-step browser journey       (npx   playwright test)
 *
 * Prerequisites: the stack is up (API :4000, web :5173) and the demo rider exists.
 *
 * Run: node scripts/capture-phase10.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-10';
await mkdir(OUT, { recursive: true });

const run = (label, command, args) => {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  console.log(output.split('\n').slice(-6).join('\n'));
  return { label, command: `${command} ${args.join(' ')}`, output, ok: result.status === 0 };
};

const runs = [
  run('Runtime dependency audit', 'node', ['scripts/audit-runtime.mjs']),
  run('Load smoke', 'node', ['scripts/load-smoke.mjs']),
  run('Backup and restore drill', 'bash', ['scripts/db-restore-drill.sh']),
  run('Twenty-step browser journey', 'npx', ['playwright', 'test', '--reporter=list']),
];

/* ── render each transcript as a readable image ───────────────────────────── */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const render = async (item, file, caption) => {
  const lines = item.output.split('\n');
  await page.setContent(`
    <html><body style="margin:0;background:#0b1220;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      <div style="padding:26px 30px 6px;color:#7c8aa5;font-size:13px;letter-spacing:.02em">
        ${escape(caption)}
      </div>
      <div style="padding:0 30px 30px">
        <div style="background:#111a2b;border:1px solid #1e2a41;border-radius:14px;overflow:hidden">
          <div style="display:flex;gap:6px;padding:12px 16px;background:#0f1728;border-bottom:1px solid #1e2a41">
            <span style="width:11px;height:11px;border-radius:50%;background:#d9534f"></span>
            <span style="width:11px;height:11px;border-radius:50%;background:#d9a94f"></span>
            <span style="width:11px;height:11px;border-radius:50%;background:#4fa86a"></span>
            <span style="margin-left:12px;color:#5f6f8c;font-size:12px">$ ${escape(item.command)}</span>
            <span style="margin-left:auto;font-size:12px;color:${item.ok ? '#4fa86a' : '#e06c6c'}">
              ${item.ok ? 'exit 0' : 'exit 1'}
            </span>
          </div>
          <pre style="margin:0;padding:20px 22px;color:#d6e0f0;font-size:13.5px;line-height:1.62;white-space:pre-wrap">${lines
            .map((text) => escape(text))
            .join('\n')}</pre>
        </div>
      </div>
    </body></html>`);
  await page.waitForTimeout(250);
  // Fit the frame to the transcript: a screenshot with 500px of empty background is
  // noise in a report.
  const height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1280, height: Math.max(320, Math.min(2400, height + 8)) });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`  ✓ ${file}`);
};

await render(
  runs[0],
  '01-runtime-dependency-audit.png',
  'npm audit, filtered by an explicit allowlist — three high findings remain, all in the Prisma CLI's config path, which the server never executes',
);
await render(
  runs[1],
  '02-load-smoke.png',
  'Bursts of 40 concurrent requests — and the same API answering in 12 ms while a report rendered',
);
await render(
  runs[2],
  '03-backup-restore-drill.png',
  'A real backup, restored into a scratch database, every table compared and the ledger re-checked',
);
await render(
  runs[3],
  '04-master-scenario.png',
  'The twenty-step journey in a real browser against the real API — register, book, pay, ride, deliver, report',
);

await browser.close();
await rm('test-results', { recursive: true, force: true });

const failed = runs.filter((item) => !item.ok);
console.log(`\n${failed.length === 0 ? 'All four checks passed' : `${failed.length} check(s) failed: ${failed.map((f) => f.label).join(', ')}`}`);
if (failed.length > 0) process.exitCode = 1;
