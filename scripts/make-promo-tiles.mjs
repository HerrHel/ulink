import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.resolve('outputs/store_assets');

(async () => {
  const browser = await chromium.launch();
  const svg = fs.readFileSync('public/favicon.svg', 'utf8');

  // 1. Large promo tile 1400x560
  const pLarge = await browser.newPage({ viewport: { width: 1400, height: 560 } });
  await pLarge.setContent(`<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }
    body { width:1400px; height:560px; overflow:hidden; background: linear-gradient(135deg, #18181B 0%, #27272A 100%); display:flex; align-items:center; justify-content:space-between; padding:0 120px; color:#F4F4F5; }
    .brand { display:flex; flex-direction:column; gap:16px; }
    .title-row { display:flex; align-items:center; gap:20px; }
    .logo-box { width:96px; height:96px; background:#C85A32; border-radius:24px; display:flex; align-items:center; justify-content:center; box-shadow:0 12px 36px rgba(200,90,50,0.4); }
    .logo-box svg { width:64px; height:64px; }
    .app-name { font-size:52px; font-weight:800; letter-spacing:1px; color:#FFF; }
    .app-en { font-size:32px; font-weight:400; color:#A1A1AA; margin-left:12px; }
    .tagline { font-size:24px; color:#D4D4D8; line-height:1.5; font-weight:400; }
    .badge-row { display:flex; gap:12px; margin-top:8px; }
    .badge { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:30px; padding:6px 18px; font-size:15px; color:#E4E4E7; }
    .visual { width:320px; height:320px; background:radial-gradient(circle, rgba(200,90,50,0.2) 0%, transparent 70%); display:flex; align-items:center; justify-content:center; }
  </style></head><body>
    <div class="brand">
      <div class="title-row">
        <div class="logo-box">${svg}</div>
        <div>
          <span class="app-name">与链</span>
          <span class="app-en">ulink</span>
        </div>
      </div>
      <div class="tagline">极简、高效、安全的单页书签管理器与随身侧边栏</div>
      <div class="badge-row">
        <span class="badge">&#9889; 一键秒级收藏</span>
        <span class="badge">&#128187; 沉浸式 Side Panel</span>
        <span class="badge">&#128274; 端到端 E2E 加密</span>
      </div>
    </div>
    <div class="visual">
      <div style="font-size:120px;opacity:0.25;color:#C85A32;">&#9733;</div>
    </div>
  </body></html>`);
  await pLarge.screenshot({ path: path.join(dir, 'promo_tile_1400x560.png') });
  console.log('Created promo_tile_1400x560.png');

  // 2. Small promo tile 440x280
  const pSmall = await browser.newPage({ viewport: { width: 440, height: 280 } });
  await pSmall.setContent(`<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }
    body { width:440px; height:280px; overflow:hidden; background: linear-gradient(135deg, #18181B 0%, #27272A 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:24px; color:#F4F4F5; gap:12px; }
    .logo-box { width:56px; height:56px; background:#C85A32; border-radius:14px; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 20px rgba(200,90,50,0.35); }
    .logo-box svg { width:38px; height:38px; }
    .title { font-size:24px; font-weight:700; color:#FFF; display:flex; align-items:center; gap:8px; }
    .subtitle { font-size:12.5px; color:#A1A1AA; line-height:1.4; max-width:320px; }
    .tag { background:rgba(200,90,50,0.2); border:1px solid #C85A32; color:#FAFAFA; font-size:11px; padding:3px 10px; border-radius:12px; margin-top:2px; font-weight:500; }
  </style></head><body>
    <div class="logo-box">${svg}</div>
    <div class="title"><span>与链</span> <span style="font-weight:400;color:#A1A1AA;font-size:18px;">ulink</span></div>
    <div class="subtitle">个人书签管理器与随身侧边栏扩展</div>
    <div class="tag">极简 · 高效 · E2E加密</div>
  </body></html>`);
  await pSmall.screenshot({ path: path.join(dir, 'promo_tile_440x280.png') });
  console.log('Created promo_tile_440x280.png');

  await browser.close();
})();
