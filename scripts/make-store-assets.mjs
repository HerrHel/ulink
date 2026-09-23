import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.resolve('outputs/store_assets');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  const svg = fs.readFileSync('public/favicon.svg', 'utf8');
  const pLogo = await browser.newPage({ viewport: { width: 300, height: 300 } });
  await pLogo.setContent(`<!DOCTYPE html><html><head><style>
    body { margin:0; overflow:hidden; background:#F5EFEA; display:flex; align-items:center; justify-content:center; width:300px; height:300px; }
    .icon { width:200px; height:200px; }
    svg { width:100%; height:100%; }
  </style></head><body><div class="icon">${svg}</div></body></html>`);
  await pLogo.screenshot({ path: path.join(dir, 'logo_300x300.png') });
  console.log('Created logo_300x300.png');

  const p1280 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p1280.goto('file:///' + path.resolve('outputs/shots/02_main_dashboard.png').replace(/\\/g, '/'));
  await p1280.screenshot({ path: path.join(dir, 'screenshot_1280x800_1.png') });
  console.log('Created screenshot_1280x800_1.png');

  const p1280_2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p1280_2.goto('file:///' + path.resolve('outputs/shots/04_search_filter.png').replace(/\\/g, '/'));
  await p1280_2.screenshot({ path: path.join(dir, 'screenshot_1280x800_2.png') });
  console.log('Created screenshot_1280x800_2.png');

  const p640 = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const imgUri = 'file:///' + path.resolve('outputs/shots/02_main_dashboard.png').replace(/\\/g, '/');
  await p640.setContent(`<!DOCTYPE html><html><body style="margin:0;overflow:hidden;"><img src="${imgUri}" style="width:640px;height:400px;display:block;"></body></html>`);
  await p640.screenshot({ path: path.join(dir, 'screenshot_640x400_1.png') });
  console.log('Created screenshot_640x400_1.png');

  await browser.close();
  console.log('Done!');
})();
