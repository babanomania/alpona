import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { installOverlay, caption, demoClick, cursorTo } from '../src/overlay';

// Narration capture: every spoken caption is recorded with the moment it
// appears, so the ElevenLabs voiceover can be placed frame-accurately later.
const narration: { text: string; at: number }[] = [];
let videoStart = 0;
async function say(page: Page, text: string): Promise<void> {
  if (videoStart) narration.push({ text, at: Date.now() - videoStart });
  await caption(page, text);
}

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@alpona.dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'alpona-demo-2026';

const BUILD_PROMPT =
  'Supplier scorecard for this quarter — lead time trends, PO value by supplier, ' +
  'and flag anyone averaging more than 3 days late.';
const ASK_PROMPT = 'Show me the fastest supplier this quarter';

// ── small choreography helpers ────────────────────────────────────
/** Show a caption and hold — gaps are sized so VO can be dropped in later. */
async function beat(page: Page, text: string | null, holdMs: number): Promise<void> {
  if (text === null) await caption(page, null);
  else await say(page, text);
  await page.waitForTimeout(holdMs);
}

/** Type into a field at a human cadence, after moving the cursor to it. */
async function typeInto(page: Page, selector: string, text: string): Promise<void> {
  await cursorTo(page, selector);
  const field = page.locator(selector).first();
  await field.click();
  await field.fill('');
  await field.pressSequentially(text, { delay: 22 });
}

/** Wait out the agent: the composer status spinner appears, then detaches. */
async function waitIdle(page: Page, ms = 240_000): Promise<void> {
  await page.waitForTimeout(1200);
  await page
    .locator('.composer__status')
    .waitFor({ state: 'detached', timeout: ms })
    .catch(() => {});
  await page.waitForTimeout(800);
}

/** First selector in the list that resolves to a visible element, else null. */
async function firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

/** The right-most widget in the dashboard's top row (by geometry). */
async function topRowRightWidget(page: Page): Promise<Locator | null> {
  const widgets = page.locator('.alpona-widget');
  const n = await widgets.count();
  const boxes: { i: number; x: number; y: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = await widgets.nth(i).boundingBox();
    if (b) boxes.push({ i, x: b.x, y: b.y, h: b.height });
  }
  if (boxes.length === 0) return null;
  const minY = Math.min(...boxes.map((b) => b.y));
  const topRow = boxes.filter((b) => b.y < minY + b.h * 0.5);
  topRow.sort((a, b) => b.x - a.x); // right-most first
  return widgets.nth(topRow[0]!.i);
}

/** Select a widget by clicking its top edge (away from chart tooltips). */
async function selectWidget(page: Page, widget: Locator): Promise<void> {
  const box = await widget.boundingBox();
  if (box) {
    await page.evaluate(
      ([x, y]) => window.__demo.moveTo(x, y, 600),
      [box.x + 26, box.y + 14] as const,
    );
    await page.evaluate(([x, y]) => window.__demo.ripple(x, y), [box.x + 26, box.y + 14] as const);
  }
  await widget.click({ position: { x: 26, y: 14 } });
}

test.beforeEach(async ({ page }) => {
  await installOverlay(page);
});

test('alpona product walkthrough', async ({ page }) => {
  // Timing origin ≈ start of the recorded video (the goto follows immediately).
  videoStart = Date.now();
  // ── Sign in ────────────────────────────────────────────────────
  await page.goto('/');
  const loginCard = page.locator('.login');
  if (await loginCard.isVisible().catch(() => false)) {
    await typeInto(page, '.login input[type="email"]', EMAIL);
    await typeInto(page, '.login input[type="password"]', PASSWORD);
    await demoClick(page, '.login__submit');
    await loginCard.waitFor({ state: 'detached', timeout: 30_000 });
  }

  // ── Beat 1 · the landing hero ──────────────────────────────────
  await page.waitForLoadState('networkidle');
  await beat(page, 'Alpona — dashboards drawn from a sentence.', 4500);
  await beat(page, 'A schema-driven generative UI engine for dashboards.', 4000);
  await caption(page, null);

  // ── Beat 2 · into the workspace ────────────────────────────────
  await demoClick(page, 'button:has-text("Start creating")');
  await page.locator('.create__box textarea').waitFor({ timeout: 15_000 });
  await beat(page, 'One box. Ask a question, or describe a whole view.', 3500);

  // ── Beat 3 · describe the dashboard ────────────────────────────
  await typeInto(page, '.create__box textarea', BUILD_PROMPT);
  await beat(page, 'Plain language in — a live, data-bound dashboard out.', 2500);
  await demoClick(page, '.create__box .btn--primary');

  // ── Beat 4 · watch it compose ──────────────────────────────────
  await say(page, 'Alpona picks the layout, widgets, and the SQL for each.');
  await page.locator('.alpona-dashboard').first().waitFor({ timeout: 240_000 });
  await waitIdle(page);
  await page.locator('.recharts-surface, .alpona-widget').first().waitFor({ timeout: 60_000 });
  await beat(page, 'Every widget is bound to agent-generated, sandboxed SQL.', 4500);
  await caption(page, null);

  // ── Beat 5 · refine one widget — top 5 ─────────────────────────
  const bar = await firstVisible(page, [
    '.alpona-widget[data-widget-type="bar_chart"]',
    '.alpona-widget[data-widget-type="leaderboard"]',
    '.alpona-widget:has(.recharts-bar)',
  ]);
  if (bar) {
    await beat(page, 'Refine a single widget — just say what you want.', 3000);
    await selectWidget(page, bar);
    await page.waitForTimeout(800);
    await typeInto(page, '.composer__bar textarea', 'top 5 only');
    await demoClick(page, '.composer__send');
    await say(page, 'Only that widget changes — the rest stay put.');
    await waitIdle(page);
    await beat(page, null, 1500);
  }

  // ── Beat 6 · refine the trend line — target at 95% ─────────────
  const line = await firstVisible(page, [
    '.alpona-widget[data-widget-type="line_chart"]',
    '.alpona-widget[data-widget-type="area_chart"]',
    '.alpona-widget:has(.recharts-line)',
  ]);
  if (line) {
    await beat(page, 'Talk to a chart the way you would a teammate.', 3000);
    await selectWidget(page, line);
    await page.waitForTimeout(800);
    await typeInto(page, '.composer__bar textarea', 'add a target line at 95%');
    await demoClick(page, '.composer__send');
    await say(page, 'A reference line, added in plain English.');
    await waitIdle(page);
    await beat(page, null, 1500);
  }

  // ── Beat 7 · ask a question → an answer ────────────────────────
  const clearScope = page.locator('.composer__scope button[aria-label="Clear selection"]');
  if (await clearScope.isVisible().catch(() => false)) await clearScope.click();
  await beat(page, 'Ask a question instead of describing a view…', 3000);
  await typeInto(page, '.composer__bar textarea', ASK_PROMPT);
  await demoClick(page, '.composer__send');
  await say(page, 'A question gets an answer — with its SQL shown.');
  await page
    .locator('.rail__entry--answer .rail__card')
    .first()
    .waitFor({ timeout: 180_000 });
  await waitIdle(page);

  // ── Beat 8 · the answer lands in the conversation rail ─────────
  const answerCard = page.locator('.rail__entry--answer .rail__card').last();
  await answerCard.scrollIntoViewIfNeeded();
  await cursorTo(page, '.rail__entry--answer .rail__card');
  await beat(page, 'The answer appears in the conversation, query and all.', 4000);
  const sqlToggle = answerCard.locator('.rail__sql-toggle');
  if (await sqlToggle.isVisible().catch(() => false)) {
    await cursorTo(page, '.rail__entry--answer .rail__card .rail__sql-toggle');
    await sqlToggle.click(); // expand the query
    await say(page, 'Read the exact query Alpona ran — nothing hidden.');
    await page.waitForTimeout(3400);
    await sqlToggle.click(); // collapse it again
    await page.waitForTimeout(1100);
  }

  // ── Beat 9 · remove the top-row, right-most widget ─────────────
  // Frees a prominent slot so the pinned answer lands in plain sight.
  const victim = await topRowRightWidget(page);
  if (victim && (await victim.isVisible().catch(() => false))) {
    await beat(page, 'Don’t need a tile? Select it…', 3000);
    await selectWidget(page, victim);
    await page.waitForTimeout(900);
    // A × appears on the selected widget — one click drops it (pure-code
    // spec surgery, the composer frees the slot; no model call).
    const removeBtn = victim.locator('.alpona-widget__remove');
    const rb = await removeBtn.boundingBox();
    if (rb) {
      await page.evaluate(
        ([x, y]) => window.__demo.moveTo(x, y, 500),
        [rb.x + rb.width / 2, rb.y + rb.height / 2] as const,
      );
      await page.evaluate(
        ([x, y]) => window.__demo.ripple(x, y),
        [rb.x + rb.width / 2, rb.y + rb.height / 2] as const,
      );
    }
    await say(page, '…and one click removes it. The layout re-flows.');
    await removeBtn.click();
    await page.waitForTimeout(2200);
    await beat(page, null, 800);
  }

  // ── Beat 10 · pin the answer onto the board as a widget ────────
  const pinBtn = page.locator('.rail__entry--answer .rail__card-actions .btn--primary').last();
  if (await pinBtn.isVisible().catch(() => false)) {
    await beat(page, 'Like the answer? Pin it onto the board as a widget.', 3000);
    await demoClick(page, '.rail__entry--answer .rail__card-actions .btn--primary');
    await say(page, 'The answer becomes a permanent, data-bound widget.');
    await waitIdle(page);
    await beat(page, null, 1500);
  }

  // ── Beat 11 · save & get a share link ──────────────────────────
  const saveBtn = page.locator('.dashboard-head__buttons button[title*="Save"]').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if (await saveBtn.isVisible().catch(() => false)) {
    await beat(page, 'Save it — the spec persists and you get a share link.', 3000);
    await cursorTo(page, '.dashboard-head__buttons button[title*="Save"]');
    await saveBtn.click();
    await page.locator('.dialog input').waitFor({ timeout: 10_000 });
    await typeInto(page, '.dialog input', 'Supplier scorecard — Q review');
    await demoClick(page, '.dialog .btn--primary');
    await page.waitForTimeout(2500);
  }

  // ── Beat 12 · explore every saved dashboard ────────────────────
  await beat(page, 'Every saved board is a portable spec with a share URL.', 3000);
  const exploreNav = await firstVisible(page, [
    '.topbar__nav a:has-text("Explore")',
    '.topbar__nav button:has-text("Explore")',
    'a:has-text("Explore")',
  ]);
  if (exploreNav) await exploreNav.click();
  else await page.evaluate(() => (window.location.hash = '#/explore'));
  await page.locator('.explore .table').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await beat(page, 'One place for every dashboard your team has drawn.', 4500);

  await caption(page, null);
  await page.waitForTimeout(1500);

  // Emit the narration timing so `pnpm vo` can synthesize a synced voiceover.
  const timingPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'timing.json');
  writeFileSync(
    timingPath,
    JSON.stringify({ durationMs: Date.now() - videoStart, lines: narration }, null, 2),
  );

  // Sanity: the walkthrough reached the saved-dashboards table.
  await expect(page.locator('.explore .table')).toBeVisible();
});
