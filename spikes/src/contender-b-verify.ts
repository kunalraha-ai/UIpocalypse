import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:3123/login');
const inputs = await p.locator('input').all();
for (const i of inputs) console.log('login input:', await i.getAttribute('placeholder'), '/', await i.getAttribute('type'));

const ev: string[] = [];
p.on('pageerror', (e) => ev.push(String(e)));
await p.goto('http://localhost:3123/profile');
await p.waitForTimeout(400);
const url1 = p.url();
await p.getByRole('button', { name: 'Save profile' }).click().catch(() => {});
await p.waitForTimeout(700);
console.log('save-profile: url changed?', p.url() !== url1, '| page errors:', ev.length);

await p.goto('http://localhost:3123/orders');
await p.waitForTimeout(2000);
console.log('orders spinner visible after 2s:', await p.getByText(/Loading your orders/i).isVisible().catch(() => false));
await p.waitForTimeout(9000);
console.log('orders spinner visible after 11s:', await p.getByText(/Loading your orders/i).isVisible().catch(() => false));

// nav-link check: does 'Credits' nav actually navigate? (my crude dead-detector flagged it)
await p.goto('http://localhost:3123/');
await p.getByRole('link', { name: 'Credits' }).click();
await p.waitForTimeout(800);
console.log('after clicking Credits nav, url:', p.url());

await b.close();
