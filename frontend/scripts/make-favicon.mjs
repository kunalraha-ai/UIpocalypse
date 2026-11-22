/** Rasterize favicon.svg → favicon.png (32) + apple-touch-icon.png (180) with Playwright. */
import { chromium } from '/home/eclipse/Documents/Projects/UIpocalypse/uipocalypse/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const shoot = async (size, out) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0}body{width:${size}px;height:${size}px}</style>` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
      `style="width:${size}px;height:${size}px;display:block">`,
  );
  await page.waitForTimeout(200);
  const buf = await page.screenshot();
  writeFileSync(out, buf);
  console.log(`wrote ${out}`);
};
await shoot(32, 'public/favicon.png');
await shoot(180, 'public/apple-touch-icon.png');
await browser.close();
