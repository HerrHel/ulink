// 渲染管线：Playwright 逐帧驱动 -> ffmpeg 管道压制
// 用法：
//   node render.mjs --stills 1.2,7.6,19.8   抽检指定秒数的单帧
//   node render.mjs                         渲染全片 MP4
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

// 优先寻找真实 Vue 页面或传入的目标页
const targetUrl = process.env.PROMO_URL || (fs.existsSync(path.join(dir, 'promo.html'))
  ? pathToFileURL(path.join(dir, 'promo.html')).href
  : 'http://localhost:5173/promo');

console.log('Target URL:', targetUrl);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });

try {
  await page.goto(targetUrl);
  await page.evaluate(() => document.fonts.ready);
} catch (e) {
  console.log('Notice: target page not running yet (waiting for next agent to hook real Vue view).');
}

if (stillsArg) {
  const sd = path.join(out, 'stills');
  fs.mkdirSync(sd, { recursive: true });
  for (const s of stillsArg.split(',').map(Number)) {
    await page.evaluate((t) => window.renderAt && window.renderAt(t), s);
    const f = path.join(sd, `t_${s.toFixed(2)}.png`);
    await page.screenshot({ path: f });
    console.log('Saved still:', f);
  }
  await browser.close();
} else {
  const mp4 = path.join(out, 'ulink-promo.mp4');
  const wav = path.join(out, 'music.wav');
  const hasAudio = fs.existsSync(wav);

  const ffArgs = [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(T.fps), '-c:v', 'png', '-i', '-'
  ];

  if (hasAudio) {
    ffArgs.push('-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  } else {
    ffArgs.push('-map', '0:v');
  }

  ffArgs.push(
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-r', String(T.fps), '-movflags', '+faststart', mp4
  );

  const ff = spawn(ffmpeg, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(T.dur * T.fps);
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await page.evaluate((t) => window.renderAt && window.renderAt(t), f / T.fps);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    if (f % 90 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await once(ff, 'close');
  await browser.close();
  console.log('done →', mp4);
}
