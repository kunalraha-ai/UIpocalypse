/** Debug helper: dump what the CDP DOMSnapshot extractor actually sees. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { APP_URL } from './lib/app.js';

async function dump(ctx: import('playwright').BrowserContext, page: import('playwright').Page, label: string) {
  const cdp = await ctx.newCDPSession(page);
  const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [] })) as unknown as {
    strings: string[];
    documents: {
      nodes: {
        nodeType: number[];
        nodeName: number[];
        textValue?: number[];
        attributes?: number[];
        parentIndex?: number[];
      };
    }[];
  };
  const nodes = snap.documents[0]!.nodes;
  console.log(`\n--- ${label} ---`);
  console.log('top keys:', Object.keys(snap), 'doc keys:', Object.keys(snap.documents[0]!), 'node keys:', Object.keys(nodes));
  console.log('strings total:', snap.strings.length);
  console.log('first 40 strings:', JSON.stringify(snap.strings.slice(0, 40)));
  console.log('nodeType[0..8]:', nodes.nodeType.slice(0, 9));
  console.log('nodeName[0..8] resolved:', nodes.nodeName.slice(0, 9).map((i) => snap.strings[i]));
  console.log('attr[0..8]:', JSON.stringify((nodes.attributes ?? []).slice(0, 9)));
  console.log('attr[15..22]:', JSON.stringify((nodes.attributes ?? []).slice(15, 23)));
  writeFileSync('/tmp/opencode/domsnapshot-dump.json', JSON.stringify(snap, null, 1).slice(0, 200000));
  await cdp.detach();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/`);
  await dump(ctx, page, 'home');
  await browser.close();
}
main();
