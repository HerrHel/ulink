const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const svg = fs.readFileSync('public/favicon.svg', 'utf8');
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:transparent;overflow:hidden;width:${size}px;height:${size}px}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${svg}</body></html>`);
    await page.screenshot({ path: `extension/icons/icon${size}.png`, omitBackground: true });
    console.log(`Generated icon${size}.png`);
  }
  await browser.close();
})();
