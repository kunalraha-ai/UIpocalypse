/**
 * Web UI end-to-end check (manual script, not part of the test suite):
 * drives the REAL frontend (frontend/dist) in headless Chromium against the
 * REAL backend and a REAL fixture app — onboarding → new run → live run →
 * report → graph → static scan → settings — asserting real data on each
 * screen and saving screenshots. Run:
 *   cd frontend && npm run build
 *   cd ../uipocalypse && npx tsx scripts/web-ui-e2e.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startWebServer } from '../src/web/server.js';
import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const FIXTURE = mkdtempSync('/tmp/opencode/uip-webui-app-');
writeFileSync(
  join(FIXTURE, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>My app</title></head><body>
  <h1>Volunteer app</h1>
  <form onsubmit="event.preventDefault(); document.getElementById('out').textContent='saved '+Date.now()">
    <input id="t" type="text" placeholder="note" />
    <button type="submit">Add note</button>
  </form>
  <button onclick="document.getElementById('out').textContent='clicked '+Date.now()">Refresh</button>
  <button id="dead">Export data</button>
  <button id="reset">Reset preferences</button>
  <p id="out"></p>
</body></html>`,
);

const serveFixture = async () => {
  const srv = httpServer((req, res) => {
    void readFile(join(FIXTURE, 'index.html')).then(
      (b) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(b);
      },
      () => {
        res.writeHead(404);
        res.end();
      },
    );
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => srv.close(() => r())) };
};

const SHOTS = '/tmp/opencode/webui-shots';
mkdirSync(SHOTS, { recursive: true });
const shot = async (page: import('playwright').Page, name: string) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  console.log(`shot: ${name}`);
};

const fixtureApp = await serveFixture();
const web = await startWebServer({
  port: 0,
  workspaceRoot: mkdtempSync('/tmp/opencode/uip-webui-ws-'),
  frontendDir: resolve(import.meta.dirname, '..', '..', 'frontend', 'dist'),
  llmEnv: { LLM_API_KEY: '' }, // fully local for the check
});
const base = `http://${web.address}:${web.port}`;
console.log(`web UI at ${base} (fixture app: ${fixtureApp.url})`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const fail = (msg: string): never => {
  throw new Error(`UI e2e failed: ${msg}`);
};

try {
  // 1) landing renders
  await page.goto(`${base}/`);
  const title = await page.title();
  if (!/UIpocalypse/i.test(title)) fail(`landing title: ${title}`);
  await shot(page, '01-landing');

  // 2) onboarding → connect the fixture project
  await page.goto(`${base}/#/app/onboarding`);
  await page.getByPlaceholder('/home/you/code/my-app').fill(FIXTURE);
  await page.getByRole('button', { name: 'Verify path' }).click();
  await page.waitForSelector('text=Path verified', { timeout: 15_000 });
  await shot(page, '02-onboarding-verified');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('http://localhost:3000').fill(fixtureApp.url);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Connect project' }).click();
  await page.waitForSelector('text=No runs yet', { timeout: 10_000 });
  await shot(page, '03-projects-empty');

  // 3) new run → launch (defaults: 30 agents, 60s — shrink via the URL-free UI: set range)
  await page.goto(`${base}/#/app/new-run`);
  await page.locator('input[type="range"]').fill('5');
  await shot(page, '04-new-run');
  await page.getByRole('button', { name: /Review & launch|Launch/ }).click();

  // 4) live run → wait for completion and the Open report button
  await page.waitForSelector('text=Open report', { timeout: 180_000 });
  await shot(page, '05-live-run-done');
  await page.getByRole('link', { name: 'Open report' }).click();

  // 5) report — real finding for the planted dead button + skipped 'Reset preferences'
  await page.waitForSelector('.finding-row', { timeout: 30_000 });
  const reportText = await page.locator('.app-main').innerText();
  if (!reportText.includes('Export data')) fail('report missing the planted dead button finding');
  if (!reportText.includes('Reset preferences')) fail('report missing the skipped-by-policy action');
  if (!/mechanical/i.test(reportText)) fail('report missing Reviewed-by mode');
  await shot(page, '06-report');

  // 6) finding detail
  await page.locator('.finding-row', { hasText: 'Export data' }).first().click();
  await page.waitForSelector('text=What broke', { timeout: 15_000 });
  const detailText = await page.locator('.app-main').innerText();
  if (!/paste|fix prompt/i.test(detailText)) fail('finding detail missing fix prompt');
  await shot(page, '07-finding');

  // 7) state graph
  await page.goto(`${base}/#/app/graph`);
  await page.waitForSelector('.graph-node', { timeout: 15_000 });
  await shot(page, '08-graph');

  // 8) static scan (plain HTML → analyzer 0 hits, but the screen must say so honestly)
  await page.goto(`${base}/#/app/static-scan`);
  await page.waitForSelector('h2', { timeout: 15_000 });
  await shot(page, '09-static-scan');

  // 9) settings shows the real mode line
  await page.goto(`${base}/#/app/settings`);
  await page.waitForSelector('text=LLM mode', { timeout: 15_000 });
  const settingsText = await page.locator('.app-main').innerText();
  if (!/LLM mode: off/i.test(settingsText)) fail(`settings missing the real mode line: ${settingsText.slice(0, 200)}`);
  if (!/cores/i.test(settingsText)) fail('settings missing machine info');
  await shot(page, '10-settings');

  console.log('\nUI e2e PASSED — every screen rendered real data. Screenshots in ' + SHOTS);
} finally {
  await browser.close();
  await web.close();
  await fixtureApp.close();
}
