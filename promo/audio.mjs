// 与链 ulink 宣传片 · 代码合成配乐（120 BPM，44.1kHz 立体声 WAV）
// 音乐与 UI 音效共用 timeline.js，所有点击/同步/加密音效与画面同帧
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
await import('./timeline.js');
const T = globalThis.T;
const SR = 44100, N = Math.round(SR * T.dur), B = 60 / T.bpm; // B = 0.5s
const L = new Float32Array(N), Rt = new Float32Array(N), REV = new Float32Array(N), DLY = new Float32Array(N), DUCK = new Float32Array(N).fill(1);
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const TAU = Math.PI * 2;
function mix(i, v, pan = 0, rev = 0, dly = 0) {
  if (i < 0 || i >= N) return;
  L[i] += v * (pan > 0 ? 1 - pan : 1); Rt[i] += v * (pan < 0 ? 1 + pan : 1);
  if (rev) REV[i] += v * rev; if (dly) DLY[i] += v * dly;
}
function biquad(type, f, q) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2; if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const at = (t) => Math.round(t * SR);

// ───────── 鼓 ─────────
function kick(t0, a = 1) {
  const i0 = at(t0), n = at(0.45); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; const f = 46 + 130 * Math.exp(-t * 32); ph += TAU * f / SR; let v = Math.sin(ph) * Math.exp(-t * 7) * Math.min(1, t / 0.002); if (t < 0.004) v += rnd() * 0.25 * (1 - t / 0.004); mix(i0 + i, Math.tanh(v * 1.5) * 0.8 * a); }
  for (let i = 0; i < at(0.32); i++) { const t = i / SR; const d = 1 - 0.65 * Math.exp(-t * 9) * Math.min(1, t / 0.004); if (i0 + i < N) DUCK[i0 + i] = Math.min(DUCK[i0 + i], d); }
}
function clap(t0, a = 0.4) {
  const i0 = at(t0), n = at(0.3), f = biquad('bp', 1300, 0.9);
  for (let i = 0; i < n; i++) { const t = i / SR; let e = Math.exp(-t * 16) * 0.6; for (const o of [0, 0.009, 0.018]) if (t >= o) e += Math.exp(-(t - o) * 260); mix(i0 + i, f(rnd()) * e * a * 2.2, 0, 0.25); }
}
function hat(t0, a = 0.12, pan = 0.25, dec = 60) {
  const i0 = at(t0), n = at(0.12), f = biquad('hp', 7500, 0.7);
  for (let i = 0; i < n; i++) { const t = i / SR; mix(i0 + i, f(rnd()) * Math.exp(-t * dec) * a, pan); }
}
function crash(t0, a = 0.18, dur = 1.8) {
  const i0 = at(t0), n = at(dur), f = biquad('hp', 4500, 0.6);
  for (let i = 0; i < n; i++) { const t = i / SR; mix(i0 + i, f(rnd()) * Math.exp(-t * 2.4) * a, (i % 2 ? 0.2 : -0.2), 0.3); }
}
function snare(t0, a = 0.25) {
  const i0 = at(t0), n = at(0.18), f = biquad('bp', 2200, 0.6);
  for (let i = 0; i < n; i++) { const t = i / SR; mix(i0 + i, (f(rnd()) * 1.6 + Math.sin(TAU * 190 * t) * 0.5) * Math.exp(-t * 22) * a, 0, 0.15); }
}
// ───────── 乐器 ─────────
function bass(t0, d, m, a = 0.32) {
  const i0 = at(t0), n = at(d + 0.05), f = mtof(m);
  for (let i = 0; i < n; i++) { const t = i / SR; const env = Math.min(1, t / 0.006) * (t < d ? 1 - 0.3 * (t / d) : Math.max(0, 1 - (t - d) / 0.05)); const v = Math.tanh(Math.sin(TAU * f * t) * 1.8 + Math.sin(TAU * 2 * f * t) * 0.25) * env * a; mix(i0 + i, v * DUCK[Math.min(N - 1, i0 + i)]); }
}
function pad(t0, d, notes, a = 0.06, cut = 0.08) {
  const i0 = at(t0), n = at(d + 0.6);
  notes.forEach((m, ni) => {
    [-7, 0, 7].forEach((cents, vi) => {
      const f = mtof(m) * 2 ** (cents / 1200); let ph = rnd() * 0.5 + 0.5, lp = 0; const pan = (vi - 1) * 0.5;
      for (let i = 0; i < n; i++) { const t = i / SR; ph += f / SR; ph -= Math.floor(ph); const saw = 2 * ph - 1; lp += cut * (saw - lp); const env = Math.min(1, t / 0.25) * (t < d ? 1 : Math.max(0, 1 - (t - d) / 0.6)); mix(i0 + i, lp * env * a * DUCK[Math.min(N - 1, i0 + i)], pan, 0.35); }
    });
    void ni;
  });
}
function pluck(t0, m, a = 0.08, pan = 0, dly = 0.35, dec = 7) {
  const i0 = at(t0), n = at(0.6), f = mtof(m);
  for (let i = 0; i < n; i++) { const t = i / SR; const v = (Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 14) + 0.2 * Math.sin(TAU * 3 * f * t) * Math.exp(-t * 22)) * Math.exp(-t * dec) * Math.min(1, t / 0.002); mix(i0 + i, v * a, pan, 0.15, dly); }
}
function bell(t0, m, a = 0.12, dur = 1.6) {
  const i0 = at(t0), n = at(dur), f = mtof(m);
  for (let i = 0; i < n; i++) { const t = i / SR; const v = Math.sin(TAU * f * t + 2.2 * Math.exp(-t * 4) * Math.sin(TAU * f * 3.5 * t)) * Math.exp(-t * 3.2) * Math.min(1, t / 0.003); mix(i0 + i, v * a, 0, 0.4, 0.2); }
}
function blip(t0, f0, f1, dur, a = 0.2, pan = 0) {
  const i0 = at(t0), n = at(dur); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / n; const f = f0 * (f1 / f0) ** x; ph += TAU * f / SR; mix(i0 + i, Math.sin(ph) * (1 - x) ** 2 * Math.min(1, i / 40) * a, pan, 0.1); }
}
function sweep(t0, dur, fa, fb, a = 0.15, shape = 'rise') {
  const i0 = at(t0), n = at(dur); let low = 0, band = 0;
  for (let i = 0; i < n; i++) { const x = i / n; const fc = fa * (fb / fa) ** x; const F = 2 * Math.sin(Math.PI * Math.min(fc, 12000) / SR); low += F * band; const high = rnd() - low - 0.7 * band; band += F * high; const env = shape === 'rise' ? x * x : shape === 'fall' ? (1 - x) ** 2 : Math.sin(Math.PI * x); mix(i0 + i, band * env * a, 0, 0.3); }
}
// UI 音效
const click = (t, a = 0.22) => { blip(t, 2600, 1700, 0.022, a); hat(t, 0.05, 0, 400); };
const thud = (t, a = 0.35) => blip(t, 130, 48, 0.28, a);
const ding = (t, m = 88, a = 0.1) => { bell(t, m, a, 1.2); bell(t + 0.0625, m + 7, a * 0.7, 1.2); };

// ───────── 编曲 ─────────
const CH = { Am: [57, 60, 64], C: [55, 60, 64], G: [55, 59, 62], F: [57, 60, 65] };
const ROOT = { Am: 45, C: 48, G: 43, F: 41 };
const BARS = ['Am', 'Am', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C'];
const chordAt = (t) => { const b = Math.floor(t / 2); if (b === 13 && t % 2 >= 1) return 'G'; return BARS[Math.min(b, 14)]; };
const grooveOn = (t) => t >= 4 && t < 28 && !(t >= T.lockSync && t < T.unlocked); // 加密段落短暂抽掉底鼓，解锁时回归

// 1) 底鼓先行（生成侧链包络）
for (let t = 4; t < 28; t += B) if (grooveOn(t)) kick(t, t === 4 || t === 20 ? 1.1 : 0.95);
kick(28, 1.1);
// 2) 鼓组
for (let t = 4; t < 28; t += B) {
  const beat = Math.round((t - 4) / B) % 4;
  if (grooveOn(t) && (beat === 1 || beat === 3)) clap(t);
  hat(t + B / 2, grooveOn(t) ? 0.11 : 0.07, 0.25);
  if (t >= 8) { hat(t + B / 4, 0.035, -0.3, 90); hat(t + 3 * B / 4, 0.035, -0.3, 90); }
}
crash(4, 0.2); crash(12, 0.1); crash(20, 0.18); crash(28, 0.22, 2.2);
// 前奏：滴答声（攒书签）+ 换场军鼓滚奏
for (let t = 0; t < 2; t += B / 2) hat(t, 0.05, 0.1, 120);
for (let i = 0; i < 12; i++) { const t = 3 + i * (1 / 12); snare(t, 0.05 + 0.18 * (i / 11)); }
for (let i = 0; i < 8; i++) snare(27 + i * 0.125, 0.06 + 0.16 * (i / 7));
// 3) 和声
for (let b = 0; b < 15; b++) {
  const t0 = b * 2;
  if (b < 2) { pad(t0, b === 0 ? 2 : 1.0, CH.Am, 0.045, 0.03); continue; }
  if (b === 13) { pad(t0, 1, CH.F, 0.055); pad(t0 + 1, 1, CH.G, 0.055); continue; }
  if (b === 14) { pad(t0, 1.4, [48, 55, 60, 64, 67], 0.05, 0.06); continue; }
  pad(t0, 2, CH[BARS[b]], 0.055);
}
// 4) 贝斯：八分音符泵感（反拍高八度）
for (let t = 4; t < 28; t += B / 2) {
  const r = ROOT[chordAt(t)], off = Math.round(t / (B / 2)) % 2 === 1;
  const susp = t >= T.lockSync && t < T.unlocked;
  bass(t, B / 2 - 0.04, off ? r + 12 : r, susp ? 0.16 : off ? 0.3 : 0.24);
}
bass(28, 1.6, 36, 0.32);
// 5) 琶音（十六分）+ 延迟
const ARP = [0, 1, 2, 3, 2, 1];
let ai = 0;
for (let t = 8; t < 28; t += B / 4, ai++) {
  const ch = CH[chordAt(t)]; const k = ARP[ai % 6];
  const m = k === 3 ? ch[0] + 24 : ch[k] + 12;
  pluck(t, m, 0.05, ai % 2 ? 0.35 : -0.35, 0.3);
}
// 尾声：C 大调分解 + 钟声
[72, 76, 79, 84].forEach((m, i) => bell(28 + i * 0.125, m, 0.09, 2));

// ───────── UI 音效（与画面同帧）─────────
T.chipWaves.forEach((t, i) => { pluck(t, 76 + [0, 2, 3, 5, 7, 8, 10][i], 0.09, 0, 0.1, 18); pluck(t + 0.125, 76 + [0, 2, 3, 5, 7, 8, 10][i] + 12, 0.04, 0.3, 0.1, 18); });
click(T.clickTabB); blip(T.clickTabB + 0.02, 900, 70, 0.6, 0.2); sweep(T.clickTabB, 0.6, 3000, 200, 0.12, 'fall');
thud(T.chipsGone, 0.4); blip(T.chipsGone, 220, 160, 0.2, 0.12);
click(T.clickExt); bell(T.clickExt, 84, 0.08); sweep(T.clickExt, 1.0, 300, 9000, 0.14, 'rise');
sweep(T.phoneIn, 0.35, 600, 2500, 0.06, 'arc');
ding(T.link + 0.25, 81, 0.07);
click(T.add); pluck(T.add, 79, 0.08, 0, 0.1, 12); ding(T.addSync, 88);
click(T.expand); sweep(T.expand, 0.3, 400, 3000, 0.06, 'arc');
click(T.nest); pluck(T.nest, 83, 0.07, 0, 0.1, 14);
click(T.notes); sweep(T.notes, 0.28, 1500, 5000, 0.05, 'arc');
click(T.collapse); sweep(T.collapse, 0.25, 3000, 500, 0.05, 'arc');
click(T.press, 0.16); pluck(T.press, 72, 0.05, 0, 0, 20);
thud(T.drop, 0.3); pluck(T.drop, 79, 0.07, 0, 0.1, 12); ding(T.groupSync, 86);
click(T.tag); pluck(T.tag, 84, 0.07, 0, 0.15, 12); pluck(T.tag + 0.0625, 88, 0.05, 0, 0.15, 12);
click(T.eye);
click(T.lock); blip(T.lock, 180, 90, 0.12, 0.3); blip(T.lock + 0.03, 3200, 2800, 0.03, 0.1);
bell(T.lockSync, 76, 0.1, 1.4); bell(T.lockSync + 0.0625, 83, 0.07, 1.4);
blip(T.tap, 900, 700, 0.05, 0.15); sweep(T.tap, 0.5, 400, 6000, 0.08, 'rise');
[84, 88, 91, 96].forEach((m, i) => bell(T.unlocked + i * 0.0625, m, 0.07, 1.4));
click(T.mqPress, 0.16);
[T.sel1, T.sel2, T.sel3].forEach((t, i) => pluck(t, 79 + i * 2, 0.07, 0, 0.1, 16));
sweep(T.bar, 0.3, 800, 3000, 0.05, 'arc');
click(T.merge); sweep(T.merge, 0.5, 300, 6000, 0.12, 'rise');
thud(T.mergeDone, 0.4); pluck(T.mergeDone, 84, 0.07, 0, 0.15, 10); ding(T.mergeSync, 88);
bell(T.logo, 79, 0.1, 2); bell(T.logo, 84, 0.08, 2);
pluck(T.url, 91, 0.06, 0, 0.3, 8);

// ───────── 效果：延迟 + 混响 ─────────
{
  const d = at(0.375), e = new Float32Array(N);
  for (let i = 0; i < N; i++) e[i] = DLY[i] + (i >= d ? e[i - d] * 0.38 : 0);
  for (let i = 0; i < N; i++) { if (i >= d) L[i] += e[i - d] * 0.5; const j = i - Math.round(d * 1.5); if (j >= 0) Rt[i] += e[j] * 0.5; }
}
for (const [ch, off] of [[L, 0], [Rt, 23]]) {
  const out = new Float32Array(N);
  for (const d0 of [1557, 1617, 1491, 1422, 1277, 1356]) {
    const d = d0 + off, buf = new Float32Array(d); let k = 0, filt = 0;
    for (let i = 0; i < N; i++) { const y = buf[k]; filt = y * 0.65 + filt * 0.35; buf[k] = REV[i] + filt * 0.8; k = (k + 1) % d; out[i] += y; }
  }
  for (const d0 of [225, 556, 441]) {
    const d = d0 + off, buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < N; i++) { const bo = buf[k]; const y = -out[i] + bo; buf[k] = out[i] + bo * 0.5; out[i] = y; k = (k + 1) % d; }
  }
  for (let i = 0; i < N; i++) ch[i] += out[i] * 0.09;
}

// ───────── 母带：归一化 + 软削波 + 淡出 ─────────
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rt[i]));
const g = 1.15 / peak, sat = Math.tanh(1.4);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const t = i / SR; const fade = Math.min(1, t / 0.02) * Math.min(1, (T.dur - t) / 0.8);
  const l = Math.tanh(L[i] * g * 1.4) / sat * 0.92 * fade, r = Math.tanh(Rt[i] * g * 1.4) / sat * 0.92 * fade;
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), 46 + i * 4);
}
fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
fs.writeFileSync(path.join(dir, 'out', 'music.wav'), buf);
console.log('music.wav written, peak(pre)=', peak.toFixed(3));
