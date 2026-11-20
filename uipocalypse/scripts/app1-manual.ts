import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:5173');
await p.waitForTimeout(1000);
const inputs = await p.locator('input, button, a').all();
for (const el of inputs) {
  const tag = await el.evaluate((e) => e.tagName);
  const ph = await el.getAttribute('placeholder');
  const text = (await el.textContent())?.trim().slice(0, 40);
  const type = await el.getAttribute('type');
  console.log(`${tag} ph="${ph ?? ''}" type="${type ?? ''}" text="${text ?? ''}"`);
}
await b.close();
