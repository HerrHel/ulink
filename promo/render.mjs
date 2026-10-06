// 渲染：Playwright 逐帧截图 → ffmpeg（libx264 + AAC）
// 用法：node render.mjs                  全片 → out/ulink-promo.mp4
//      node render.mjs --stills 1.6,7.6  仅渲染指定秒数的静帧 → out/stills/
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
await import('./timeline.js');
const T = globalThis.T;
const out = path.join(dir, 'out');
fs.mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(pathToFileURL(path.join(dir, 'promo.html')).href);
await page.evaluate(() => document.fonts.ready);

if (stillsArg) {
  const sd = path.join(out, 'stills');
  fs.mkdirSync(sd, { recursive: true });
  for (const s of stillsArg.split(',').map(Number)) {
    await page.evaluate((t) => window.renderAt(t), s);
    const f = path.join(sd, `t_${s.toFixed(2)}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
  await browser.close();
} else {
  const wav = path.join(out, 'music.wav');
  if (!fs.existsSync(wav)) throw new Error('先运行 node audio.mjs 生成 out/music.wav');
  const mp4 = path.join(out, 'ulink-promo.mp4');
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(T.fps), '-c:v', 'png', '-i', '-',
    '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(T.fps),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(T.dur * T.fps);
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await page.evaluate((t) => window.renderAt(t), f / T.fps);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    if (f % 90 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await once(ff, 'close');
  await browser.close();
  console.log('done →', mp4);
}
