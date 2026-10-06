// 与链 ulink 宣传片 · 画面（纯 DOM/CSS/SVG，按时间 t 确定性渲染：window.renderAt(t)）
// 规则：所有位置/尺寸/圆角变化走弹簧（线性叠加，打断时速度连续）；触发点全部取自 timeline.js 的半拍网格
'use strict';
const T = window.T;
const W = 1920, H = 1080;
const ACC = '#122E8A', ACT = '#E7EBF6', GRN = '#10B981', GRT = '#E2F6EE', INK = '#1A1E2C';
const BW = { x: 320, y: 150, w: 1280, h: 780 };   // 痛点浏览器窗口
const LAP = { x: 110, y: 170, w: 1160, h: 700 };  // 笔记本屏幕
const PH = { x: 1440, y: 150, w: 360, h: 740 };   // 手机外框
const GO = { x: 250, y: 140 };                    // 网格在屏幕内的原点
const GWX = LAP.x + GO.x, GWY = LAP.y + GO.y;     // 网格世界坐标原点 (360,310)
const CW = 280, CH = 120;
const PSX = PH.x + 10, PSY = PH.y + 10;           // 手机屏幕世界原点
const LY = 116, PITCH = 84;                       // 手机列表

// ───────── 弹簧 ─────────
const SP = {
  pop: { w: 18, z: 0.62 },   // 到位轻弹（约 9% 过冲）
  big: { w: 14, z: 0.72 },   // 大尺寸变化，过冲更收敛
  soft: { w: 11, z: 0.8 },
  cur: { w: 13, z: 0.9 },    // 光标移动
  drag: { w: 9.5, z: 0.85 },
  mq: { w: 12, z: 0.9 },
  fall: { w: 6.5, z: 1 },    // 临界阻尼：起步像重力下坠，目标在画外
  line: { w: 9, z: 0.9 },
  pulse: { w: 15, z: 0.82 },
};
function spr(t, p) {
  if (t <= 0) return 0;
  const w = p.w, z = p.z;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
// 关键帧轨道：v0 + Σ(Δv · spring)，线性叠加
function trk(v0, keys) {
  return (t) => {
    let v = v0, pv = v0;
    for (const k of keys) { if (t > k[0]) v += (k[1] - pv) * spr(t - k[0], SP[k[2] || 'pop']); pv = k[1]; }
    return v;
  };
}
const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lin = (t, t0, d) => cl((t - t0) / d);
const eout = (x) => 1 - Math.pow(1 - x, 3);
function rng(s) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let q = Math.imul(s ^ (s >>> 15), 1 | s); q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q; return ((q ^ (q >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261003);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// ───────── DOM 工具 ─────────
function D(p, x, y, w, h, st, html, cls) {
  const e = document.createElement('div');
  e.className = 'a' + (cls ? ' ' + cls : '');
  e.style.left = x + 'px'; e.style.top = y + 'px';
  if (w != null) e.style.width = w + 'px';
  if (h != null) e.style.height = h + 'px';
  if (st) Object.assign(e.style, st);
  if (html) e.innerHTML = html;
  p.appendChild(e);
  return e;
}
const bar = (p, x, y, w, h, c) => D(p, x, y, w, h, { background: c || '#D8CFC7', borderRadius: h / 2 + 'px' });
const txt = (p, x, y, s, st, cls) => D(p, x, y, null, null, Object.assign({ whiteSpace: 'nowrap', lineHeight: '1' }, st || {}), s, cls);
function put(e, x, y, s = 1, r = 0, o = 1) { e.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`; e.style.opacity = o; }
function size(e, w, h, r) { if (w != null) e.style.width = w + 'px'; if (h != null) e.style.height = h + 'px'; if (r != null) e.style.borderRadius = r + 'px'; }
function popAt(e, t, t0, from = 0.6, dy = 0, p = 'pop') {
  if (t < t0) { e.style.opacity = 0; return 0; }
  const k = spr(t - t0, SP[p]);
  put(e, 0, dy * (1 - k), from + (1 - from) * k, 0, lin(t, t0, 0.1));
  return k;
}

const IC = {
  bm: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  tree: '<path d="M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  finger: '<path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>',
};
const ico = (n, s, c, sw) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const icoBox = (p, x, y, w, h, n, s, c, st, cls) => D(p, x, y, w, h, st, ico(n, s, c), 'fx' + (cls ? ' ' + cls : ''));
const logo = (p, x, y, s, cls) => D(p, x, y, s, s, { background: ACC, borderRadius: Math.round(s * 0.28) + 'px' }, ico('link', Math.round(s * 0.58), '#fff', 2.5), 'fx' + (cls ? ' ' + cls : ''));

const FAV = [[ACT, ACC, 'circle'], ['#EFE8E1', '#9A8E83', 'square'], [GRT, GRN, 'tri'], [ACT, ACC, 'diamond'], ['#EFE8E1', '#9A8E83', 'ring'], ['#EFE8E1', '#9A8E83', 'tri'], [GRT, GRN, 'circle'], [ACT, ACC, 'square']];
function fav(p, x, y, s, k) {
  const [bg, fg, sh] = FAV[((k % FAV.length) + FAV.length) % FAV.length];
  const e = D(p, x, y, s, s, { background: bg, borderRadius: Math.round(s * 0.28) + 'px' });
  const g = Math.round(s * 0.44), o = (s - g) / 2;
  const shp = {
    circle: `<circle cx="12" cy="12" r="9" fill="${fg}"/>`,
    square: `<rect x="4" y="4" width="16" height="16" rx="4" fill="${fg}"/>`,
    tri: `<path d="M12 3L21.5 20H2.5z" fill="${fg}"/>`,
    diamond: `<path d="M12 2l10 10-10 10L2 12z" fill="${fg}"/>`,
    ring: `<circle cx="12" cy="12" r="7.5" fill="none" stroke="${fg}" stroke-width="4.5"/>`,
  }[sh];
  e.innerHTML = `<svg style="position:absolute;left:${o}px;top:${o}px" width="${g}" height="${g}" viewBox="0 0 24 24">${shp}</svg>`;
  return e;
}

const U = [];
const world = document.getElementById('world');
const stage = D(world, 0, 0, W, H); stage.style.transformOrigin = '960px 1040px';
const ov = D(world, 0, 0, W, H);

// ═════════ 笔记本外壳 ═════════
const bez = D(stage, LAP.x - 14, LAP.y - 14, LAP.w + 28, LAP.h + 28, { background: '#FFFFFF', border: '1px solid #E3D9CF', borderRadius: '24px', boxShadow: '0 30px 70px rgba(90,60,30,.10)' }, '', 'c');
const base = D(stage, LAP.x - 90, LAP.y + LAP.h + 14, LAP.w + 180, 26, { background: '#EDE6DF', border: '1px solid #E0D6CC', borderRadius: '4px 4px 22px 22px' }, '', 'c');
D(base, (LAP.w + 180) / 2 - 80, -1, 160, 9, { background: '#E2D9D0', borderRadius: '0 0 9px 9px' });
U.push((t) => {
  const t0 = T.clickExt + 0.25;
  if (t < t0) { bez.style.opacity = 0; base.style.opacity = 0; return; }
  put(bez, 0, 0, 0.96 + 0.04 * spr(t - t0, SP.big), 0, lin(t, t0, 0.12));
  put(base, 0, 40 * (1 - spr(t - t0 - 0.06, SP.pop)), 1, 0, lin(t, t0, 0.12));
});

// ═════════ 屏幕：浏览器窗口 → 笔记本屏幕（同一元素弹簧变形）═════════
const scr = D(stage, 0, 0, BW.w, BW.h, { overflow: 'hidden', background: '#FCFAF8', border: '1px solid #E3DAD1' }, '', 'c');
const sX = trk(BW.x, [[T.clickExt, LAP.x, 'big']]), sY = trk(BW.y, [[T.clickExt, LAP.y, 'big']]);
const sW = trk(BW.w, [[T.clickExt, LAP.w, 'big']]), sH = trk(BW.h, [[T.clickExt, LAP.h, 'big']]), sR = trk(18, [[T.clickExt, 10, 'big']]);
U.push((t) => {
  const s = 0.94 + 0.06 * spr(t + 0.05, SP.pop);
  put(scr, sX(t), sY(t), s, 0, lin(t, -0.05, 0.12));
  size(scr, sW(t), sH(t), sR(t));
  const m = 1 - lin(t, T.clickExt, 0.4);
  scr.style.boxShadow = `0 30px 80px rgba(90,60,30,${(0.13 * m).toFixed(3)})`;
});

// ───────── ① 痛点层 ─────────
const painL = D(scr, 0, 0, BW.w, BW.h);
D(painL, 0, 0, BW.w, 56, { background: '#EFE8E1' });
['#D5CBC1', '#DDD4CB', '#E3DBD3'].forEach((c, i) => D(painL, 22 + i * 20, 22, 12, 12, { background: c, borderRadius: '6px' }));
const TAB = { a: 110, b: 320, w: 200 };
const tabHi = D(painL, TAB.a, 10, TAB.w, 46, { background: '#FCFAF8', borderRadius: '12px 12px 0 0' });
D(painL, TAB.a + 18, 23, 20, 20, { border: '3.5px solid #6E7080', borderRadius: '50%' }); bar(painL, TAB.a + 48, 29, 110, 8, '#CFC6BE');
D(painL, TAB.b + 18, 23, 20, 20, { background: '#A3988D', borderRadius: '6px' }); bar(painL, TAB.b + 48, 29, 96, 8, '#D8CFC7');
const tabX = trk(0, [[T.clickTabB, TAB.b - TAB.a]]);
D(painL, 0, 56, BW.w, 48, { background: '#FCFAF8', borderBottom: '1px solid #EEE7E0' });
D(painL, 22, 70, 20, 20, { background: '#EAE3DC', borderRadius: '10px' }); D(painL, 52, 70, 20, 20, { background: '#EAE3DC', borderRadius: '10px' });
const addr = D(painL, 110, 62, 820, 36, { background: '#F2EDE8', borderRadius: '18px' }); bar(addr, 30, 14, 260, 8, '#D3CAC1');
D(painL, BW.w - 104, 68, 26, 26, { background: '#E6DED6', borderRadius: '8px' });
const extI = logo(painL, BW.w - 60, 66, 30, 'c');
D(painL, 0, 104, BW.w, 40, { background: '#FCFAF8', borderBottom: '1px solid #EEE7E0' });
const bbar = [];
for (let i = 0; i < 13; i++) { const e = D(painL, 16 + i * 94, 111, 86, 26, { background: '#F4EFEA', borderRadius: '8px' }, '', 'c'); fav(e, 6, 6, 14, i); bar(e, 26, 9, 50, 7, '#D6CDC5'); bbar.push(e); }
const painC = D(painL, 0, 144, BW.w, BW.h - 144, { overflow: 'hidden' });
const pile = [];
for (let i = 0; i < 36; i++) {
  const w = 150 + R() * 90 | 0, x = 30 + R() * (860 - w), y = 22 + R() * 540, rot = (R() - 0.5) * 36;
  const e = D(painC, x, y, w, 46, { background: '#fff', border: '1px solid #E8DFD6', borderRadius: '12px', boxShadow: '0 4px 12px rgba(80,60,40,.08)' }, '', 'c');
  fav(e, 10, 10, 26, i); bar(e, 46, 19, w - 70, 9, i % 3 ? '#D8CFC7' : '#CFC6BE');
  pile.push({ e, rot, wave: i % 7, fd: R() * 0.2, vr: (R() - 0.5) * 70 });
}
// 统计卡：书签/密码计数
const stat = D(painC, 950, 26, 300, 150, { borderRadius: '18px' }, '', 'card c');
icoBox(stat, 22, 22, 34, 34, 'bm', 28, ACC);
const statBm = txt(stat, 70, 18, '0', { fontSize: '44px', fontWeight: '700', color: INK }, 'num');
icoBox(stat, 24, 94, 30, 30, 'key', 24, '#7A7470');
const statKey = txt(stat, 70, 92, '0', { fontSize: '32px', fontWeight: '700', color: INK }, 'num');
const empty = D(painC, 410, 190, 220, 170, { border: '2.5px dashed #D3C9BF', borderRadius: '22px' }, '', 'c');
icoBox(empty, 80, 38, 60, 60, 'bm', 48, '#C8BEB4', null); bar(empty, 60, 118, 100, 10, '#E0D8D0');
U.push((t) => {
  tabHi.style.transform = `translateX(${tabX(t)}px)`;
  painL.style.opacity = 1 - lin(t, T.clickExt, 0.15);
  painL.style.display = t > T.clickExt + 0.2 ? 'none' : '';
  const waves = T.chipWaves.filter((w) => t >= w).length;
  bbar.forEach((e, i) => {
    const tw = T.chipWaves[Math.min(i >> 1, 6)];
    if (t < tw) { e.style.opacity = 0; return; }
    const k = spr(t - tw, SP.pop), g = spr(t - T.clickTabB - i * 0.02, SP.pop);
    put(e, 0, 0, (0.5 + 0.5 * k) * (1 - g), 0, g > 0.97 ? 0 : 1);
  });
  for (const c of pile) {
    const tw = T.chipWaves[c.wave];
    if (t < tw) { c.e.style.opacity = 0; continue; }
    const k = spr(t - tw, SP.pop), f = spr(t - T.clickTabB - c.fd, SP.fall);
    put(c.e, 0, 1100 * f, 0.5 + 0.5 * k, c.rot + c.vr * f, 1);
  }
  const gone = t >= T.chipsGone;
  statBm.textContent = gone ? '0' : fmt(1284 * waves / 7);
  statKey.textContent = gone ? '0' : String(Math.round(36 * waves / 7));
  statBm.style.color = statKey.style.color = gone ? '#B3A89E' : INK;
  const sh = gone ? Math.exp(-(t - T.chipsGone) * 9) * Math.sin((t - T.chipsGone) * 48) * 14 : 0;
  put(stat, sh, 0, 1, 0, 1);
  popAt(empty, t, T.chipsGone, 0.6);
  popAt(extI, t, T.chipsGone + 0.25, 0.3);
});

// ───────── ② 应用层（笔记本）─────────
const app = D(scr, 0, 0, LAP.w, LAP.h);
D(app, 0, 0, LAP.w, 64, { background: '#FFFFFF', borderBottom: '1px solid #EEE7E0' });
const tb = [];
tb.push(logo(app, 22, 16, 32, 'c'));
tb.push(txt(app, 64, 22, '与链', { fontSize: '20px', fontWeight: '700', color: INK }, 'c'));
const srch = D(app, 250, 14, 380, 36, { background: '#F3EEE9', borderRadius: '18px' }, '', 'c'); icoBox(srch, 12, 9, 18, 18, 'search', 17, '#A69B91'); bar(srch, 42, 14, 150, 8, '#D9D0C8'); tb.push(srch);
const cntBox = D(app, 690, 16, 160, 32, null, '', 'c'); icoBox(cntBox, 0, 4, 24, 24, 'bm', 22, ACC);
const lapCnt = txt(cntBox, 32, 5, '0', { fontSize: '24px', fontWeight: '700', color: INK }, 'num'); tb.push(cntBox);
const syncB = D(app, 880, 22, 120, 20, null, '', 'c'); const lapDot = D(syncB, 0, 5, 10, 10, { background: GRN, borderRadius: '5px' }, '', 'c'); bar(syncB, 18, 6, 56, 8, '#D8CFC7'); tb.push(syncB);
const plusB = D(app, 1096, 12, 40, 40, { background: ACC, borderRadius: '20px' }, ico('plus', 20, '#fff', 2.6), 'fx c'); tb.push(plusB);
D(app, 0, 64, 220, LAP.h - 64, { background: '#FAF7F3', borderRight: '1px solid #EEE7E0' });
const side = [];
[96, 80, 104, 70, 88, 76, 92, 64].forEach((bw, i) => {
  const it = D(app, 14, 84 + i * 46, 192, 38, { borderRadius: '10px', background: i === 0 ? ACT : 'transparent' }, '', 'c');
  D(it, 12, 8, 22, 22, { background: i === 0 ? ACC : '#E6DED6', borderRadius: '7px' }); bar(it, 46, 15, bw, 8, i === 0 ? '#9AA6CF' : '#D6CDC5');
  side.push(it);
});
const chipAll = D(app, 250, 84, 64, 34, { background: ACC, borderRadius: '17px', color: '#fff', fontSize: '15px', fontWeight: '600' }, '全部', 'fx c');
const chipFav = D(app, 326, 84, 112, 34, { background: '#fff', border: '1px solid #E6DED6', borderRadius: '17px', fontSize: '15px', color: '#4A4F60', gap: '7px' },
  `<span style="width:8px;height:8px;border-radius:4px;background:${GRN}"></span>常用<b class="num" style="font-weight:700;color:${INK}">12</b>`, 'fx c');
const favN = chipFav.querySelector('b');
const chipWork = D(app, 450, 84, 66, 34, { background: '#fff', border: '1px solid #E6DED6', borderRadius: '17px', fontSize: '15px', color: '#4A4F60' }, '工作', 'fx c');
const lapIn = T.clickExt + 0.25;
U.push((t) => {
  app.style.opacity = lin(t, T.clickExt + 0.1, 0.1);
  tb.forEach((e, i) => popAt(e, t, lapIn + i * 0.04, 0.6));
  side.forEach((e, i) => { const t0 = lapIn + 0.1 + i * 0.03; if (t < t0) { e.style.opacity = 0; return; } put(e, -30 * (1 - spr(t - t0, SP.pop)), 0, 1, 0, lin(t, t0, 0.1)); });
  [chipAll, chipFav, chipWork].forEach((e, i) => popAt(e, t, T.lapCards + i * 0.04, 0.6));
  // 计数：0 → 1,284（找回）→ 1,285（新增）
  lapCnt.textContent = t >= T.add ? '1,285' : fmt(1284 * eout(lin(t, T.lapCards, 0.5)));
  if (t >= T.add) { const k = spr(t - T.add, SP.pop); lapCnt.style.transform = `scale(${1 + 0.25 * (1 - k)})`; }
  // “常用”计数 12 → 13（打标签）
  favN.textContent = t >= T.tag ? '13' : '12';
  if (t >= T.tag) favN.style.display = 'inline-block', favN.style.transform = `scale(${1 + 0.4 * (1 - spr(t - T.tag, SP.pop))})`;
  // 按 + 时按钮下压
  if (t > T.add - 0.05 && t < T.add + 0.4) plusB.style.transform = `scale(${pressScale(t, T.add)})`;
});
function pressScale(t, tc) { const u = t - tc; return u > -0.02 && u < 0.3 ? 1 - 0.12 * Math.sin(Math.PI * cl(u / 0.16)) * (u < 0.16 ? 1 : 0) : 1; }

// ───────── 网格 ─────────
const grid = D(app, GO.x, GO.y, 880, 560, { overflow: 'hidden' });
const SLOTS = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) { if (c === 2 && r < 2) continue; SLOTS.push([c * 300, r * 140]); }
const ORD = [
  [T.lapCards, ['A', 'B', 'C', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']],
  [T.add, ['N', 'A', 'B', 'C', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']],
  [T.reflow, ['N', 'A', 'B', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']],
  [T.mergeDone, ['N', 'A', 'B', 'P', 'NG', 'S', 'V', 'W', 'X', 'Y', 'Z']],
];
function slotTracks(id) {
  let first = null; const kx = [], ky = [];
  for (const [tt, ord] of ORD) {
    const i = ord.indexOf(id); if (i < 0) continue;
    const [x, y] = SLOTS[i];
    if (!first) { first = { t: tt, i, x, y }; continue; }
    const st = tt + Math.min(i, 10) * 0.012;
    kx.push([st, x]); ky.push([st, y]);
  }
  return { first, x: trk(first.x, kx), y: trk(first.y, ky) };
}
const cards = {};
function mkCard(id, k, opt = {}) {
  const e = D(grid, 0, 0, CW, CH, { borderRadius: '16px' }, '', 'card c');
  const inner = D(e, 0, 0, CW, CH);
  if (opt.key) icoBox(inner, 16, 16, 40, 40, 'key', 22, ACC, { background: ACT, borderRadius: '11px' });
  else fav(inner, 16, 16, 40, k);
  bar(inner, 68, 23, opt.tw || (100 + R() * 60 | 0), 11, '#CDC4BB'); bar(inner, 68, 44, 60 + R() * 50 | 0, 8, '#E4DDD6');
  const foot = D(inner, 0, 0, CW, CH);
  if (!opt.key) { bar(foot, 16, 88, 48, 16, '#F2EDE8'); bar(foot, 70, 88, 34, 16, '#F2EDE8'); }
  const c = { id, e, inner, foot, k, tr: slotTracks(id), z: 2 };
  cards[id] = c;
  return c;
}
function defSt(c, t) {
  const tr = c.tr, t0 = tr.first.t + (c.id === 'N' || c.id === 'NG' ? 0 : tr.first.i * 0.035);
  if (t < t0) return { x: tr.x(t), y: tr.y(t), w: CW, h: CH, r: 16, s: 0.6, rot: 0, o: 0 };
  const k = spr(t - t0, SP.pop);
  return { x: tr.x(t), y: tr.y(t), w: CW, h: CH, r: 16, s: 0.7 + 0.3 * k, rot: 0, o: lin(t, t0, 0.1) };
}
function apply(c, s) {
  put(c.e, s.x, s.y, s.s, s.rot || 0, s.o);
  size(c.e, s.w, s.h, s.r);
  c.e.style.zIndex = s.z || c.z;
  c.e.style.display = s.o <= 0 ? 'none' : '';
}
// 分组容器 G「设计」：第 3 列跨两行
const G = D(grid, 600, 0, 280, 260, { borderRadius: '16px' }, '', 'card c'); G.style.zIndex = 1;
icoBox(G, 16, 14, 32, 32, 'folder', 18, ACC, { background: ACT, borderRadius: '9px' });
txt(G, 58, 20, '设计', { fontSize: '19px', fontWeight: '700', color: INK });
const gCnt = D(G, 228, 17, 36, 26, { background: ACT, borderRadius: '13px', color: ACC, fontSize: '15px', fontWeight: '700' }, '3', 'fx num');
[[1, 92], [5, 70], [3, 104]].forEach(([k, bw], i) => { const r = D(G, 12, 56 + i * 48, 256, 40, { background: '#F7F3EF', borderRadius: '10px' }); fav(r, 9, 9, 22, k); bar(r, 40, 16, bw, 8, '#D6CDC5'); });
const gSlot = D(G, 12, 200, 256, 40, { border: `1.5px dashed ${ACC}`, borderRadius: '10px', background: 'rgba(18,46,138,.04)' }, '', 'c');
const gRing = D(G, 0, 0, null, null, { width: '100%', height: '100%', border: `2px solid ${ACC}`, borderRadius: '16px' });

const order0 = ['A', 'B', 'C', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const kinds = { A: 0, B: 1, C: 2, P: 0, Q: 3, R: 4, S: 5, T: 6, U: 7, V: 1, W: 2, X: 0, Y: 4, Z: 3, N: 6 };
mkCard('N', 6, { tw: 128 });
order0.forEach((id) => mkCard(id, kinds[id], id === 'A' ? { tw: 120 } : id === 'P' ? { key: true, tw: 110 } : {}));
const NG = { id: 'NG', e: D(grid, 0, 0, CW, CH, { borderRadius: '16px' }, '', 'card c'), tr: slotTracks('NG'), z: 4 };
cards.NG = NG;
const newDot = D(cards.N.e, CW - 24, 14, 10, 10, { background: GRN, borderRadius: '5px' }, '', 'c');

// ── A：多层嵌套 + 富文本笔记 ──
const A = cards.A; A.z = 3;
const aBadge = D(A.foot, 196, 86, 68, 22, { background: '#F2EDE8', borderRadius: '11px', gap: '6px', fontSize: '14px', fontWeight: '700', color: '#6E6A75' }, ico('tree', 14, '#8A837D') + '<span class="num">8</span>', 'fx');
const aChev = icoBox(A.e, 0, 16, 24, 24, 'chev', 16, '#7A7470', { background: '#F4EFEA', borderRadius: '8px' });
const aNoteB = icoBox(A.e, 0, 16, 24, 24, 'note', 15, '#7A7470', { background: '#F4EFEA', borderRadius: '8px' }, 'c');
const TREE = [
  { lv: 0, k: 1, tw: 120 }, { lv: 0, k: 3, tw: 100, chev: 1 }, { lv: 1, k: 2, tw: 96 },
  { lv: 1, k: 5, tw: 84, chev: 2, cnt: 2 }, { lv: 2, k: 0, tw: 80, later: 1 }, { lv: 2, k: 6, tw: 70, later: 1 },
  { lv: 1, k: 4, tw: 90 }, { lv: 0, k: 7, tw: 110 },
];
let idx0 = 0;
TREE.forEach((r, i) => {
  r.i1 = i; r.i0 = r.later ? -1 : idx0++;
  const x = 12 + r.lv * 22, w = 256 - r.lv * 22;
  r.e = D(A.e, x, 0, w, 36, { background: r.lv === 0 ? '#F7F3EF' : '#FAF7F4', borderRadius: '10px' });
  if (r.lv > 0) D(r.e, -13, -10, 10, 28, { borderLeft: '1.5px solid #DCD3CA', borderBottom: '1.5px solid #DCD3CA', borderBottomLeftRadius: '6px' });
  let fx = 10;
  if (r.chev) { r.ch = icoBox(r.e, 6, 10, 16, 16, 'chev', 14, '#7A7470', null, 'c'); fx = 26; }
  fav(r.e, fx, 8, 20, r.k); bar(r.e, fx + 28, 14, r.tw, 8, r.lv === 0 ? '#CFC6BE' : '#DAD2CA');
  if (r.cnt) r.cntE = D(r.e, w - 34, 9, 24, 18, { background: '#EDE6DF', borderRadius: '9px', fontSize: '12px', fontWeight: '700', color: '#6E6A75' }, String(r.cnt), 'fx num');
});
// 笔记面板（抽屉式，被卡片 overflow 裁切）
const notes = D(A.e, 296, 64, 268, 460, { background: '#FBF8F5', borderRadius: '14px', border: '1px solid #EFE8E1' });
const nItems = [];
const nt = (e) => { nItems.push(e); return e; };
['B', 'I', 'H'].forEach((g, i) => nt(D(notes, 12 + i * 32, 12, 26, 26, { borderRadius: '7px', background: i === 0 ? ACT : 'transparent', color: i === 0 ? ACC : '#6E6A75', fontSize: '15px', fontWeight: i === 0 ? '800' : '600', fontStyle: i === 1 ? 'italic' : 'normal', fontFamily: 'Georgia,serif' }, g, 'fx')));
nt(icoBox(notes, 108, 12, 26, 26, 'tree', 15, '#6E6A75')); nt(icoBox(notes, 140, 12, 26, 26, 'check', 15, '#6E6A75'));
D(notes, 12, 48, 244, 1, { background: '#EDE6DF' });
nt(bar(notes, 16, 64, 150, 16, '#2B3044'));
nt(bar(notes, 16, 94, 230, 9, '#D9D0C8')); nt(bar(notes, 16, 110, 200, 9, '#D9D0C8'));
const hl = nt(D(notes, 16, 124, 236, 14)); bar(hl, 0, 3, 70, 9, '#D9D0C8'); bar(hl, 76, 0, 84, 14, ACC); bar(hl, 166, 3, 60, 9, '#D9D0C8');
[[1, 150], [1, 120], [0, 170]].forEach(([done, bw], i) => {
  const row = nt(D(notes, 16, 154 + i * 28, 236, 18));
  D(row, 0, 0, 18, 18, done ? { background: GRN, borderRadius: '5px' } : { border: '1.8px solid #CFC6BE', borderRadius: '5px' }, done ? ico('check', 12, '#fff', 3.2) : '', 'fx');
  bar(row, 28, 5, bw, 8, done ? '#E2DAD3' : '#D3CAC2');
});
nt(bar(notes, 16, 250, 110, 13, '#2B3044'));
[190, 160].forEach((bw, i) => { const row = nt(D(notes, 16, 276 + i * 22, 236, 10)); D(row, 2, 2, 6, 6, { background: '#9A8E83', borderRadius: '3px' }); bar(row, 16, 1, bw, 8, '#D6CDC5'); });
const quote = nt(D(notes, 16, 328, 236, 40)); D(quote, 0, 0, 3, 40, { background: ACC, borderRadius: '2px' }); bar(quote, 14, 8, 200, 8, '#D6CDC5'); bar(quote, 14, 24, 150, 8, '#D6CDC5');
const emb = nt(D(notes, 16, 384, 236, 56, { background: '#fff', border: '1px solid #EAE2DA', borderRadius: '12px' })); fav(emb, 12, 14, 28, 2); bar(emb, 50, 16, 120, 9, '#CFC6BE'); bar(emb, 50, 32, 80, 7, '#E4DDD6');
const aW = trk(CW, [[T.notes, 580, 'big'], [T.collapse, CW, 'big']]);
const aH = trk(CH, [[T.expand, 540, 'big'], [T.collapse, CH, 'big']]);
const noteX = trk(40, [[T.notes, 0, 'pop']]);
A.st = (t) => {
  const s = defSt(A, t);
  s.w = aW(t); s.h = aH(t);
  s.z = t > T.expand - 0.01 && t < T.collapse + 0.6 ? 6 : 3;
  s.s *= pressScale(t, T.expand) * (t > T.collapse - 0.05 ? pressScale(t, T.collapse) : 1);
  return s;
};
U.push((t) => {
  const w = aW(t);
  const ex = t >= T.expand && t < T.collapse ? 1 : 0;
  // 头部按钮贴右缘
  aChev.style.transform = `translate(${w - 40}px,0)`;
  aChev.firstChild.style.transform = `rotate(${180 * (spr(t - T.expand, SP.pop) - spr(t - T.collapse, SP.pop))}deg)`;
  aNoteB.style.left = (w - 72) + 'px';
  if (t < T.expand + 0.25 || t > T.collapse) aNoteB.style.opacity = 0;
  else { const k = spr(t - T.expand - 0.25, SP.pop); aNoteB.style.opacity = lin(t, T.expand + 0.25, 0.1); aNoteB.style.transform = `scale(${(0.5 + 0.5 * k) * pressScale(t, T.notes)})`; }
  const on = t >= T.notes; aNoteB.style.background = on ? ACT : '#F4EFEA'; aNoteB.querySelector('svg').setAttribute('stroke', on ? ACC : '#7A7470');
  A.foot.style.opacity = t < T.expand ? 1 : ex ? 1 - lin(t, T.expand, 0.08) : lin(t, T.collapse + 0.1, 0.12);
  // 树
  for (const r of TREE) {
    const opened = t >= T.nest;
    const tApp = r.later ? T.nest + (r.i1 - 4) * 0.06 : T.expand + 0.08 + r.i0 * 0.05;
    const y0 = 76 + (r.later ? r.i1 : r.i0) * 42;
    const y = r.later ? y0 : y0 + (r.i0 !== r.i1 ? (r.i1 - r.i0) * 42 * spr(t - T.nest - 0.04, SP.pop) : 0);
    if (t < tApp || t > T.collapse + 0.15) { r.e.style.opacity = 0; continue; }
    const k = spr(t - tApp, SP.pop);
    put(r.e, 0, y + 10 * (1 - k), 1, 0, lin(t, tApp, 0.1) * (1 - lin(t, T.collapse, 0.12)));
    if (r.chev === 2) { r.ch.style.transform = `rotate(${-90 + 90 * spr(t - T.nest, SP.pop)}deg) scale(${pressScale(t, T.nest)})`; r.cntE.style.opacity = 1 - lin(t, T.nest, 0.1); }
    else if (r.ch) r.ch.style.transform = 'rotate(0deg)';
    void opened;
  }
  // 笔记
  notes.style.transform = `translateX(${noteX(t)}px)`;
  notes.style.opacity = t >= T.notes && t < T.collapse + 0.3 ? 1 : 0;
  nItems.forEach((e, i) => popAt(e, t, T.notes + 0.08 + i * 0.03, 0.85, 8));
});

// ── C：拖进「设计」组，再打「常用」标签 ──
const C = cards.C;
const cRow = D(C.e, 0, 0, 256, 40); fav(cRow, 9, 9, 22, 2); bar(cRow, 40, 16, 96, 8, '#D6CDC5');
const tagB = D(C.e, 0, 9, 22, 22, { border: '1.5px solid #CFC6BE', borderRadius: '11px', background: '#fff', overflow: 'hidden' });
const tagIco = icoBox(tagB, 3, 3, 14, 14, 'tag', 12, '#9A8E83');
const tagPill = D(tagB, 0, 0, 64, 22, { gap: '5px', fontSize: '12px', fontWeight: '700', color: '#0B8A5E', justifyContent: 'flex-start', paddingLeft: '9px' }, `<span style="width:6px;height:6px;border-radius:3px;background:${GRN}"></span>常用`, 'fx');
const curX = (t) => CUR.x(t), curY = (t) => CUR.y(t);
let grab = null, dropS = null;
C.st = (t) => {
  if (t < T.press) return defSt(C, t);
  if (!grab) { const s0 = defSt(C, T.press); grab = { x: curX(T.press) - GWX - s0.x, y: curY(T.press) - GWY - s0.y }; }
  const vel = (curX(t) - curX(t - 1 / 30)) * 30;
  const lift = spr(t - T.press, SP.pop);
  if (t < T.drop) return { x: curX(t) - GWX - grab.x, y: curY(t) - GWY - grab.y, w: CW, h: CH, r: 16, s: 1 + 0.05 * lift, rot: cl(vel * 0.006, -6, 6), o: 1, z: 10 };
  if (!dropS) { const vd = (curX(T.drop) - curX(T.drop - 1 / 30)) * 30; dropS = { x: curX(T.drop) - GWX - grab.x, y: curY(T.drop) - GWY - grab.y, rot: cl(vd * 0.006, -6, 6) }; }
  const k = spr(t - T.drop, SP.pop);
  return { x: dropS.x + (612 - dropS.x) * k, y: dropS.y + (200 - dropS.y) * k, w: CW + (256 - CW) * k, h: CH + (40 - CH) * k, r: 16 - 6 * k, s: 1.05 - 0.05 * k, rot: dropS.rot * (1 - k), o: 1, z: t < T.drop + 0.5 ? 10 : 2 };
};
const tagW = trk(22, [[T.tag, 64]]);
U.push((t) => {
  const lifted = t >= T.press && t < T.drop + 0.2;
  C.e.style.boxShadow = lifted ? '0 24px 40px rgba(60,40,20,.16),0 4px 10px rgba(60,40,20,.08)' : (t >= T.drop ? 'none' : '');
  C.inner.style.opacity = t < T.drop ? 1 : 1 - lin(t, T.drop, 0.1);
  cRow.style.opacity = lin(t, T.drop + 0.05, 0.12);
  C.e.style.background = t >= T.drop ? '#F7F3EF' : '#fff';
  C.e.style.borderColor = t >= T.drop + 0.2 ? 'transparent' : '#EAE2DA';
  // 组高亮 + 占位槽 + 计数
  const hv = t >= T.hover && t < T.drop + 0.25;
  gRing.style.opacity = hv ? lin(t, T.hover, 0.08) * (1 - lin(t, T.drop + 0.1, 0.15)) : 0;
  if (t >= T.hover && t < T.drop + 0.1) popAt(gSlot, t, T.hover, 0.8); else gSlot.style.opacity = 0;
  gCnt.textContent = t >= T.drop ? '4' : '3';
  gCnt.style.transform = t >= T.drop ? `scale(${1 + 0.35 * (1 - spr(t - T.drop, SP.pop))})` : '';
  if (t < T.drop) popAt(G, t, T.lapCards + 0.07, 0.7); else G.style.transform = `scale(${1 + 0.025 * Math.sin(Math.PI * lin(t, T.drop, 0.2))})`;
  // 标签按钮 → 「常用」药丸（锚定右缘）
  const w = tagW(t);
  tagB.style.left = (256 - 8 - w) + 'px'; tagB.style.width = w + 'px';
  if (t < T.drop + 0.5) tagB.style.opacity = 0;
  else { const k = spr(t - T.drop - 0.5, SP.pop); tagB.style.opacity = lin(t, T.drop + 0.5, 0.1); tagB.style.transform = `scale(${(0.4 + 0.6 * k) * pressScale(t, T.tag)})`; }
  const tg = t >= T.tag;
  tagB.style.background = tg ? GRT : '#fff'; tagB.style.borderColor = tg ? GRT : '#CFC6BE';
  tagIco.style.opacity = tg ? 0 : 1; tagPill.style.opacity = tg ? lin(t, T.tag + 0.04, 0.1) : 0;
});

// ── P：密码 → E2E 加密 ──
const Pc = cards.P;
const pField = D(Pc.e, 16, 72, 248, 36, { background: '#F5F1ED', borderRadius: '10px' });
const pTxt = txt(pField, 12, 9, '••••••••', { fontSize: '18px', fontWeight: '700', color: '#3A3F52', letterSpacing: '1px' }, 'mono');
const pEye = icoBox(pField, 186, 4, 28, 28, 'eye', 18, '#8A837D', { borderRadius: '8px' }, 'c');
const pLockO = icoBox(pField, 216, 4, 28, 28, 'unlock', 17, '#8A837D', { borderRadius: '8px' }, 'c');
const pLockC = icoBox(pField, 216, 4, 28, 28, 'lock', 17, '#fff', { borderRadius: '8px', background: ACC }, 'c');
const pE2E = D(Pc.e, CW - 16 - 60, 18, 60, 24, { background: ACC, borderRadius: '12px', gap: '4px', color: '#fff', fontSize: '12px', fontWeight: '800', letterSpacing: '.5px' }, ico('lock', 11, '#fff', 2.6) + 'E2E', 'fx c');
const PW = 'Kx9#mP2q', CIPHER = '9f2c·a7e1·04bd';
const HEX = '0123456789abcdef';
function scramble(t, len) { let s = ''; const f = Math.floor(t * 30); for (let i = 0; i < len; i++) s += HEX[(f * 7 + i * 13 + ((f * i) % 5)) % 16]; return s; }
U.push((t) => {
  if (t < T.eye) pTxt.textContent = '••••••••';
  else if (t < T.lock) pTxt.textContent = PW;
  else if (t < T.lock + 0.25) pTxt.textContent = scramble(t, 14);
  else pTxt.textContent = CIPHER;
  const enc = t >= T.lock;
  pTxt.style.color = enc ? ACC : '#3A3F52';
  pTxt.style.fontSize = enc ? '15px' : '18px'; pTxt.style.top = enc ? '11px' : '9px';
  pField.style.background = enc ? ACT : (t >= T.eye ? '#FFF' : '#F5F1ED');
  pField.style.boxShadow = t >= T.eye && !enc ? 'inset 0 0 0 1.5px #E2D9D0' : '';
  pEye.style.transform = `scale(${pressScale(t, T.eye)})`; pEye.style.background = t >= T.eye && !enc ? '#F1ECE7' : 'transparent';
  pEye.style.opacity = enc ? 0 : 1;
  pLockO.style.opacity = enc ? 0 : 1; pLockO.style.transform = `scale(${pressScale(t, T.lock)})`;
  if (enc) { const k = spr(t - T.lock, SP.pop); pLockC.style.opacity = 1; pLockC.style.transform = `scale(${0.5 + 0.5 * k})`; } else pLockC.style.opacity = 0;
  popAt(pE2E, t, T.lock + 0.25, 0.4);
});

// ── 框选目标 Q R T U ──
const SEL = { Q: T.sel1, R: T.sel2, T: T.sel3, U: T.sel3 };
Object.keys(SEL).forEach((id, i) => {
  const c = cards[id];
  c.ring = D(c.e, 0, 0, null, null, { width: '100%', height: '100%', border: `2.5px solid ${ACC}`, borderRadius: 'inherit' });
  c.chk = D(c.e, CW - 36, 10, 24, 24, { background: ACC, borderRadius: '12px' }, ico('check', 14, '#fff', 3), 'fx c');
  c.mi = i;
  c.st = (t) => {
    const s = defSt(c, t);
    const sk = spr(t - SEL[id], SP.pop);
    s.s *= 1 - 0.035 * sk + 0.035 * spr(t - T.merge, SP.pop);
    if (t >= T.merge) {
      if (!c.from) { const f = defSt(c, T.merge); c.from = { x: f.x, y: f.y }; }
      const k = spr(t - T.merge - i * 0.03, SP.pop);
      s.x = c.from.x + (SLOTS[4][0] + i * 5 - c.from.x) * k;
      s.y = c.from.y + (SLOTS[4][1] + i * 4 - c.from.y) * k;
      s.rot = (i % 2 ? 3 : -3) * k;
      s.z = 3 + (4 - i);
      if (t >= T.mergeDone) { s.s *= 1 - 0.1 * spr(t - T.mergeDone, SP.pop); s.o = 1 - lin(t, T.mergeDone, 0.12); }
    }
    return s;
  };
});
U.push((t) => {
  for (const id of Object.keys(SEL)) {
    const c = cards[id], ts = SEL[id];
    const o = t >= ts ? lin(t, ts, 0.06) * (1 - lin(t, T.merge + 0.2, 0.15)) : 0;
    c.ring.style.opacity = o; c.chk.style.opacity = o;
    c.chk.style.transform = `scale(${t >= ts ? 0.3 + 0.7 * spr(t - ts, SP.pop) : 0.3})`;
  }
});
// ── NG：新分组 ──
icoBox(NG.e, 16, 16, 40, 40, 'folder', 22, ACC, { background: ACT, borderRadius: '11px' });
txt(NG.e, 68, 26, '新分组', { fontSize: '19px', fontWeight: '700', color: INK });
const ngCnt = D(NG.e, CW - 52, 22, 36, 26, { background: ACC, borderRadius: '13px', color: '#fff', fontSize: '15px', fontWeight: '700' }, '4', 'fx num');
[3, 4, 6, 7].forEach((k, i) => { const f = fav(NG.e, 16 + i * 22, 74, 30, k); f.style.border = '2px solid #fff'; f.style.borderRadius = '10px'; });
NG.st = (t) => { const s = defSt(NG, t); s.s = t < T.mergeDone ? 0.85 : 0.85 + 0.15 * spr(t - T.mergeDone, SP.pop); return s; };

// ── 框选矩形 + 批量条 ──
const mq = D(app, 0, 0, 10, 10, { border: `1.5px solid ${ACC}`, background: 'rgba(18,46,138,.07)', borderRadius: '4px' });
mq.style.zIndex = 20;
const bb = D(app, (LAP.w - 420) / 2, 0, 420, 56, { background: ACC, borderRadius: '28px', boxShadow: '0 14px 30px rgba(18,46,138,.22)' });
bb.style.zIndex = 21;
D(bb, 10, 10, 36, 36, { background: '#fff', borderRadius: '18px', color: ACC, fontSize: '18px', fontWeight: '800' }, '4', 'fx num');
bar(bb, 58, 24, 96, 9, 'rgba(255,255,255,.45)');
D(bb, 238, 16, 1.5, 24, { background: 'rgba(255,255,255,.25)' });
const bbBtn = D(bb, 262, 8, 150, 40, { background: '#fff', borderRadius: '20px', gap: '10px' }, ico('folderPlus', 20, ACC, 2.2) + `<span style="width:70px;height:9px;border-radius:5px;background:#9AA6CF;display:block"></span>`, 'fx c');
const bbY = trk(LAP.h + 20, [[T.bar, 624], [T.mergeDone, LAP.h + 20]]);
U.push((t) => {
  // 框选：起点在侧栏与网格之间的空隙
  if (t >= T.mqPress && t < T.sel3 + 0.2) {
    const x0 = MQ0.x - LAP.x, y0 = MQ0.y - LAP.y, x1 = curX(t) - LAP.x, y1 = curY(t) - LAP.y;
    mq.style.opacity = 1 - lin(t, T.sel3, 0.15);
    put(mq, Math.min(x0, x1), Math.min(y0, y1), 1, 0, 1 - lin(t, T.sel3, 0.15));
    size(mq, Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else mq.style.opacity = 0;
  put(bb, 0, bbY(t), 1, 0, t >= T.bar ? 1 : 0);
  bbBtn.style.transform = `scale(${pressScale(t, T.merge)})`;
  // 网格卡片
  for (const id in cards) { const c = cards[id]; apply(c, c.st ? c.st(t) : defSt(c, t)); }
  newDot.style.opacity = t < T.expand ? 1 : 1 - lin(t, T.expand, 0.15);
  lapDot.style.transform = `scale(${1 + 0.5 * pulseHit(t)})`;
});

// ═════════ 手机 ═════════
const ph = D(stage, PH.x, PH.y, PH.w, PH.h, { background: '#FFFFFF', border: '1px solid #E3D9CF', borderRadius: '54px', boxShadow: '0 30px 70px rgba(90,60,30,.10)' }, '', 'c');
const phs = D(ph, 9, 9, PH.w - 20, PH.h - 20, { background: '#FCFAF8', borderRadius: '44px', overflow: 'hidden', border: '1px solid #EEE7E0' });
D(phs, 120, 12, 100, 28, { background: '#1E2230', borderRadius: '14px' });
txt(phs, 30, 19, '9:41', { fontSize: '15px', fontWeight: '700', color: INK });
bar(phs, 262, 22, 18, 9, '#BDB3AA'); bar(phs, 286, 21, 24, 11, '#BDB3AA');
const phHead = D(phs, 0, 52, 340, 50);
logo(phHead, 18, 6, 30); txt(phHead, 56, 11, '与链', { fontSize: '20px', fontWeight: '700', color: INK });
icoBox(phHead, 206, 11, 20, 20, 'bm', 17, ACC);
const phCnt = txt(phHead, 230, 12, '0', { fontSize: '19px', fontWeight: '700', color: INK }, 'num');
const phDot = D(phHead, 306, 17, 9, 9, { background: GRN, borderRadius: '5px' }, '', 'c');
const prow = {};
function mkPRow(id, kind, k) {
  const e = D(phs, 16, 0, 308, 72, { background: '#fff', border: '1px solid #EAE2DA', borderRadius: '18px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(80,60,40,.05)' }, '', 'c');
  const main = D(e, 0, 0, 308, 72);
  if (kind === 'g') {
    icoBox(main, 14, 16, 40, 40, 'folder', 22, ACC, { background: ACT, borderRadius: '11px' });
    txt(main, 66, 26, '设计', { fontSize: '19px', fontWeight: '700', color: INK });
  } else if (kind === 'p') {
    icoBox(main, 14, 16, 40, 40, 'key', 22, ACC, { background: ACT, borderRadius: '11px' });
    bar(main, 66, 23, 110, 11, '#CDC4BB'); bar(main, 66, 43, 80, 8, '#E4DDD6');
  } else { fav(main, 14, 16, 40, k); bar(main, 66, 23, 100 + R() * 70 | 0, 11, '#CDC4BB'); bar(main, 66, 43, 60 + R() * 50 | 0, 8, '#E4DDD6'); }
  const r = { id, e, main, kind };
  prow[id] = r;
  return r;
}
['N', 'A', 'B', 'P', 'G', 'C', 'Q', 'R', 'S', 'T'].forEach((id) => mkPRow(id, id === 'G' ? 'g' : id === 'P' ? 'p' : 'n', kinds[id]));
const pgCnt = D(prow.G.main, 248, 23, 36, 26, { background: ACT, borderRadius: '13px', color: ACC, fontSize: '15px', fontWeight: '700' }, '3', 'fx num');
const pnDot = D(prow.N.main, 280, 31, 10, 10, { background: GRN, borderRadius: '5px' }, '', 'c');
// P 行：右上角锁 / E2E；展开区：密文字段 + 指纹解锁
const pp = prow.P;
const ppLock = icoBox(pp.main, 262, 24, 26, 26, 'unlock', 17, '#9A8E83', null, 'c');
const ppE2E = D(pp.main, 226, 24, 60, 24, { background: ACC, borderRadius: '12px', gap: '4px', color: '#fff', fontSize: '12px', fontWeight: '800' }, ico('lock', 11, '#fff', 2.6) + 'E2E', 'fx c');
const ppField = D(pp.e, 14, 84, 214, 46, { background: ACT, borderRadius: '12px' });
const ppTxt = txt(ppField, 14, 15, CIPHER, { fontSize: '15px', fontWeight: '700', color: ACC }, 'mono');
const ppBtn = D(pp.e, 240, 80, 54, 54, { background: ACT, borderRadius: '27px' }, '', 'c');
const ppFin = icoBox(ppBtn, 0, 0, 54, 54, 'finger', 28, ACC, null, 'c');
const ppChk = D(ppBtn, 0, 0, 54, 54, { background: GRN, borderRadius: '27px' }, ico('check', 26, '#fff', 3), 'fx c');
ppBtn.insertAdjacentHTML('beforeend', `<svg class="a" width="54" height="54" viewBox="0 0 54 54" style="transform:rotate(-90deg);transform-origin:50% 50%"><circle id="ring" cx="27" cy="27" r="25" fill="none" stroke="${GRN}" stroke-width="3" stroke-linecap="round" stroke-dasharray="157.1" stroke-dashoffset="157.1"/></svg>`);
const ppRing = ppBtn.querySelector('#ring');
// NG 内容（Q 行在同步后变成新分组）
const qNG = D(prow.Q.e, 0, 0, 308, 72, { background: '#fff' });
icoBox(qNG, 14, 16, 40, 40, 'folder', 22, ACC, { background: ACT, borderRadius: '11px' });
txt(qNG, 66, 26, '新分组', { fontSize: '19px', fontWeight: '700', color: INK });
D(qNG, 248, 23, 36, 26, { background: ACC, borderRadius: '13px', color: '#fff', fontSize: '15px', fontWeight: '700' }, '4', 'fx num');

const PS = [
  { t: T.phoneRows, ord: ['A', 'B', 'P', 'G', 'C', 'Q', 'R', 'S', 'T'], ext: 0 },
  { t: T.addSync, ord: ['N', 'A', 'B', 'P', 'G', 'C', 'Q', 'R', 'S', 'T'], ext: 0 },
  { t: T.groupSync, ord: ['N', 'A', 'B', 'P', 'G', 'Q', 'R', 'S', 'T'], ext: 0, merge: { C: 'G' } },
  { t: T.lockSync, ord: ['N', 'A', 'B', 'P', 'G', 'Q', 'R', 'S', 'T'], ext: 76 },
  { t: T.mergeSync, ord: ['N', 'A', 'B', 'P', 'G', 'Q', 'S', 'T'], ext: 76, merge: { R: 'Q' } },
];
function pY(st, id) {
  let id2 = id; if (st.merge && st.merge[id]) id2 = st.merge[id];
  const i = st.ord.indexOf(id2); if (i < 0) return null;
  const iP = st.ord.indexOf('P');
  return LY + i * PITCH + (i > iP ? st.ext : 0);
}
for (const id in prow) {
  const r = prow[id]; let first = null; const keys = [];
  PS.forEach((st, si) => {
    const y = pY(st, id); if (y == null) return;
    if (!first) { first = { t: st.t, y, i: st.ord.indexOf(id), si }; return; }
    keys.push([st.t, y]);
    const mg = st.merge && st.merge[id]; if (mg && r.gone == null) r.gone = st.t;
  });
  r.first = first; r.y = trk(first.y, keys);
}
const ppH = trk(72, [[T.lockSync, 148, 'big']]);
U.push((t) => {
  const pin = t < T.phoneIn ? 0 : spr(t - T.phoneIn, SP.big);
  put(ph, 0, 160 * (1 - pin), 0.92 + 0.08 * pin, 0, lin(t, T.phoneIn, 0.12));
  phCnt.textContent = t >= T.addSync ? '1,285' : fmt(1284 * eout(lin(t, T.phoneRows, 0.5)));
  phCnt.style.transform = t >= T.addSync ? `scale(${1 + 0.25 * (1 - spr(t - T.addSync, SP.pop))})` : '';
  phCnt.style.transformOrigin = '0 50%';
  phDot.style.transform = `scale(${1 + 0.8 * arriveHit(t)})`;
  for (const id in prow) {
    const r = prow[id];
    const t0 = r.first.t + (r.first.si === 0 ? r.first.i * 0.035 : 0);
    if (t < t0) { r.e.style.opacity = 0; continue; }
    const k = spr(t - t0, SP.pop);
    let s = 0.7 + 0.3 * k, o = lin(t, t0, 0.1);
    if (r.gone != null && t >= r.gone) { s *= 1 - 0.06 * spr(t - r.gone, SP.pop); o *= 1 - lin(t, r.gone + 0.08, 0.15); r.e.style.zIndex = 0; }
    put(r.e, 0, r.y(t), s, 0, o);
  }
  pgCnt.textContent = t >= T.groupSync ? '4' : '3';
  pgCnt.style.transform = t >= T.groupSync ? `scale(${1 + 0.35 * (1 - spr(t - T.groupSync, SP.pop))})` : '';
  pnDot.style.opacity = t < T.expand ? 1 : 1 - lin(t, T.expand, 0.15);
  // P 行：加密同步 → 展开 → 指纹 → 还原
  size(pp.e, null, ppH(t));
  const ls = t >= T.lockSync;
  ppLock.style.opacity = ls ? 0 : 1;
  if (ls) popAt(ppE2E, t, T.lockSync, 0.4); else ppE2E.style.opacity = 0;
  const un = t >= T.unlocked;
  ppTxt.textContent = un ? PW : (t >= T.unlocked - 0.25 ? scramble(t, 14) : CIPHER);
  ppTxt.style.color = un ? '#0B6E4F' : ACC; ppTxt.style.fontSize = un ? '18px' : '15px'; ppTxt.style.top = un ? '13px' : '15px';
  ppField.style.background = un ? GRT : ACT;
  ppBtn.style.transform = `scale(${pressScale(t, T.tap)})`;
  ppBtn.style.background = un ? GRT : ACT;
  ppRing.setAttribute('stroke-dashoffset', (157.1 * (1 - cl(spr(t - T.tap, SP.soft) * 1.0))).toFixed(1));
  ppRing.style.opacity = t >= T.tap && !un ? 1 : 0;
  ppFin.style.opacity = un ? 0 : 1;
  if (un) { ppChk.style.opacity = 1; ppChk.style.transform = `scale(${0.4 + 0.6 * spr(t - T.unlocked, SP.pop)})`; } else ppChk.style.opacity = 0;
  qNG.style.opacity = t >= T.mergeSync ? lin(t, T.mergeSync, 0.1) : 0;
  qNG.style.transform = t >= T.mergeSync ? `scale(${0.9 + 0.1 * spr(t - T.mergeSync, SP.pop)})` : '';
});

// ═════════ 同步连线 + 脉冲 ═════════
const LK = { x0: LAP.x + LAP.w + 20, x1: PH.x - 6, y: 520 };
const lkWrap = D(stage, LK.x0, LK.y - 8, LK.x1 - LK.x0, 16, { overflow: 'hidden' });
lkWrap.innerHTML = `<svg width="${LK.x1 - LK.x0}" height="16"><line x1="6" y1="8" x2="${LK.x1 - LK.x0 - 6}" y2="8" stroke="#CDBFB2" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"/><circle cx="6" cy="8" r="4" fill="#CDBFB2"/><circle cx="${LK.x1 - LK.x0 - 6}" cy="8" r="4" fill="#CDBFB2"/></svg>`;
const lkStat = D(stage, (LK.x0 + LK.x1) / 2 - 50, LK.y - 52, 100, 30, { background: '#fff', border: '1px solid #E6DED6', borderRadius: '15px', gap: '7px', fontSize: '13px', fontWeight: '700', color: '#4A4F60' }, '', 'fx c');
lkStat.innerHTML = `<span id="sd" style="width:8px;height:8px;border-radius:4px;background:${GRN}"></span><span id="sl">已同步</span>`;
const sd = lkStat.querySelector('#sd'), sl = lkStat.querySelector('#sl');
const PULSES = [[T.add, T.addSync, GRN], [T.drop, T.groupSync, GRN], [T.lock, T.lockSync, ACC], [T.mergeDone, T.mergeSync, GRN]];
const pDot = D(stage, 0, LK.y - 9, 18, 18, { borderRadius: '9px', border: '3px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,.12)' }, '', 'c');
const pLock = icoBox(pDot, -1, -1, 14, 14, 'lock', 9, '#fff', null);
const arrRing = D(stage, LK.x1 - 20, LK.y - 20, 40, 40, { borderRadius: '20px', border: `2px solid ${GRN}` }, '', 'c');
function pulseHit(t) { for (const [a] of PULSES) { const u = t - a; if (u >= 0 && u < 0.3) return Math.sin(Math.PI * u / 0.3); } return 0; }
function arriveHit(t) { for (const [, b] of PULSES) { const u = t - b; if (u >= 0 && u < 0.3) return Math.sin(Math.PI * u / 0.3); } return 0; }
const lkW = (t) => spr(t - T.link, SP.line);
U.push((t) => {
  lkWrap.style.width = ((LK.x1 - LK.x0) * lkW(t)) + 'px';
  popAt(lkStat, t, T.link + 0.25, 0.6);
  let act = null;
  for (const p of PULSES) if (t >= p[0] && t < p[1] + 0.15) act = p;
  sl.textContent = act && t < act[1] ? '同步中' : '已同步';
  sd.style.background = act && t < act[1] ? (act[2]) : GRN;
  if (act) {
    const k = spr(t - act[0], SP.pulse);
    const x = LK.x0 + 6 + (LK.x1 - LK.x0 - 12) * k - 9;
    pDot.style.background = act[2];
    put(pDot, x, 0, 0.6 + 0.4 * spr(t - act[0], SP.pop), 0, 1 - lin(t, act[1], 0.12));
    pLock.style.opacity = act[2] === ACC ? 1 : 0;
  } else pDot.style.opacity = 0;
  let ar = null; for (const p of PULSES) if (t >= p[1] && t < p[1] + 0.4) ar = p;
  if (ar) { const u = t - ar[1]; arrRing.style.borderColor = ar[2]; put(arrRing, 0, 0, 0.4 + 0.9 * spr(u, SP.soft), 0, 1 - lin(u, 0.1, 0.3)); } else arrRing.style.opacity = 0;
});

// ═════════ 顶部：品牌 + 功能步骤 ═════════
const brand = D(ov, 110, 50, null, 48, { display: 'flex', alignItems: 'center', gap: '14px', whiteSpace: 'nowrap' });
const bl = logo(brand, 0, 0, 46); bl.style.position = 'relative';
brand.insertAdjacentHTML('beforeend', `<span style="font-size:32px;font-weight:800;color:${INK};letter-spacing:1px">与链</span><span style="font-size:32px;font-weight:700;color:${ACC};font-family:'Segoe UI',sans-serif">ulink</span>`);
const STEPS = ['跨端同步', '多层嵌套', '分组标签', 'E2E 加密', '批量成组'];
const stepWrap = D(ov, 0, 72, null, 40);
const stepEls = []; let sx0 = 0;
const stepInd = D(stepWrap, 0, 0, 100, 40, { background: ACC, borderRadius: '20px' });
STEPS.forEach((s) => { const e = D(stepWrap, sx0, 0, null, 40, { padding: '0 20px', borderRadius: '20px', fontSize: '17px', fontWeight: '700', color: '#7A7470', background: 'rgba(255,255,255,.7)', border: '1px solid #E6DED6', whiteSpace: 'nowrap' }, s, 'fx c'); stepEls.push(e); sx0 += e.offsetWidth + 12; });
const stepTotal = sx0 - 12;
stepWrap.style.left = (960 - stepTotal / 2) + 'px';
stepEls.forEach((e) => { e.dataset.x = parseFloat(e.style.left); e.dataset.w = e.offsetWidth; });
const indX = trk(+stepEls[0].dataset.x, T.steps.slice(1).map((ts, i) => [ts, +stepEls[i + 1].dataset.x]));
const indW = trk(+stepEls[0].dataset.w, T.steps.slice(1).map((ts, i) => [ts, +stepEls[i + 1].dataset.w]));
const brandW = brand.offsetWidth;
const BS = 2.1;
const brX = trk(110, [[T.end, 960 - brandW * BS / 2, 'big']]), brY = trk(50, [[T.end, 118, 'big']]), brS = trk(1, [[T.end, BS, 'big']]);
const tag1 = bar(ov, 960 - 240, 262, 480, 16, '#CDC4BB'); tag1.classList.add('c');
const tag2 = bar(ov, 960 - 150, 292, 300, 14, '#DDD5CD'); tag2.classList.add('c');
const urlP = D(ov, 960 - 112, 330, 224, 50, { background: '#fff', border: '1px solid #E3DAD1', borderRadius: '25px', gap: '10px', fontSize: '22px', fontWeight: '700', color: INK, fontFamily: "'Segoe UI',sans-serif" }, ico('link', 20, ACC, 2.4) + 'ulink.ren', 'fx c');
const stS = trk(1, [[T.end, 0.7, 'big']]);
U.push((t) => {
  stage.style.transform = `scale(${stS(t)})`;
  if (t < T.phoneIn) brand.style.opacity = 0;
  else { const k = spr(t - T.phoneIn, SP.pop); brand.style.opacity = lin(t, T.phoneIn, 0.1); brand.style.transform = `translate(${brX(t) - 110 - 20 * (1 - k)}px,${brY(t) - 50}px) scale(${brS(t)})`; }
  const cur = T.steps.filter((s) => t >= s).length - 1;
  stepEls.forEach((e, i) => {
    const t0 = T.link + i * 0.0625;
    if (t < t0) { e.style.opacity = 0; return; }
    const k = spr(t - t0, SP.pop), hide = spr(t - T.end - i * 0.03, SP.pop);
    put(e, 0, 10 * (1 - k) - 70 * hide, 0.7 + 0.3 * k, 0, lin(t, t0, 0.1) * (1 - lin(t, T.end + i * 0.03, 0.15)));
    e.style.color = i === cur ? '#fff' : '#7A7470';
    e.style.background = i === cur ? 'transparent' : 'rgba(255,255,255,.7)';
    e.style.borderColor = i === cur ? 'transparent' : '#E6DED6';
  });
  if (cur < 0) stepInd.style.opacity = 0;
  else {
    const hide = spr(t - T.end, SP.pop);
    put(stepInd, indX(t), -70 * hide, 1, 0, 1 - lin(t, T.end, 0.15));
    size(stepInd, indW(t));
  }
  popAt(tag1, t, T.tagline, 0.7, 10); popAt(tag2, t, T.tagline + 0.125, 0.7, 10); popAt(urlP, t, T.url, 0.6, 10);
});

// ═════════ 光标 ═════════
const P0 = (sx, sy) => [sx, sy];
const TGT = {
  tabB: P0(BW.x + TAB.b + 100, BW.y + 33),
  ext: P0(BW.x + BW.w - 45, BW.y + 81),
  rest: P0(1000, 975),
  plus: P0(LAP.x + 1116, LAP.y + 32),
  aChev: P0(GWX + SLOTS[1][0] + CW - 28, GWY + SLOTS[1][1] + 28),
  l2b: P0(GWX + SLOTS[1][0] + 12 + 22 + 14, GWY + SLOTS[1][1] + 76 + 3 * 42 + 18),
  aNote: P0(GWX + SLOTS[1][0] + CW - 60, GWY + SLOTS[1][1] + 28),
  aChevW: P0(GWX + SLOTS[1][0] + 580 - 28, GWY + SLOTS[1][1] + 28),
  grab: P0(GWX + SLOTS[3][0] + 140, GWY + SLOTS[3][1] + 60),
  overG: P0(GWX + 730, GWY + 150),
  tagB: P0(GWX + 612 + 256 - 8 - 11, GWY + 200 + 20),
  eye: P0(GWX + SLOTS[3][0] + 16 + 186 + 14, GWY + SLOTS[3][1] + 72 + 18),
  lock: P0(GWX + SLOTS[3][0] + 16 + 216 + 14, GWY + SLOTS[3][1] + 72 + 18),
  unlock: P0(PSX - 1 + 16 + 240 + 27, PSY - 1 + LY + 3 * PITCH + 80 + 27),
  mq0: P0(LAP.x + GO.x - 14, LAP.y + GO.y + 266),
  mq1: P0(GWX + 290, GWY + 410), mq2: P0(GWX + 590, GWY + 410), mq3: P0(GWX + 590, GWY + 552),
  bbBtn: P0(LAP.x + (LAP.w - 420) / 2 + 262 + 75, LAP.y + 624 + 28),
};
const MQ0 = { x: TGT.mq0[0], y: TGT.mq0[1] };
const CK = [
  [1.25, TGT.tabB], [2.25, TGT.ext], [3.25, TGT.rest], [6.25, TGT.plus], [7.75, TGT.aChev], [9.25, TGT.l2b],
  [10.25, TGT.aNote], [11.25, TGT.aChevW], [12.5, TGT.grab], [13.5, TGT.overG, 'drag'], [15.0, TGT.tagB],
  [16.0, TGT.eye], [17.5, TGT.lock], [18.5, TGT.unlock], [20.5, TGT.rest], [21.25, TGT.mq0],
  [22.0, TGT.mq1, 'mq'], [22.5, TGT.mq2, 'mq'], [23.0, TGT.mq3, 'mq'], [24.25, TGT.bbBtn], [25.75, [1060, 975]],
];
const CUR = {
  x: trk(1180, CK.map((k) => [k[0], k[1][0], k[2] || 'cur'])),
  y: trk(760, CK.map((k) => [k[0], k[1][1], k[2] || 'cur'])),
};
const CLICKS = [[T.clickTabB], [T.clickExt], [T.add], [T.expand], [T.nest], [T.notes], [T.collapse], [T.press], [T.tag], [T.eye], [T.lock], [T.tap, 1], [T.mqPress], [T.merge]];
const HOLDS = [[T.press, T.drop], [T.mqPress, T.sel3]];
const curEl = D(stage, 0, 0, 40, 50);
curEl.style.zIndex = 50;
const arrow = D(curEl, 0, 0, 34, 46, { filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.18))' }, '<svg width="34" height="46" viewBox="0 0 24 32"><path d="M2 2 L2 25.5 L8.2 19.6 L12.6 29.6 L16.6 27.8 L12.3 18.2 L20.8 18.2 Z" fill="#14182A" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>');
const touch = D(curEl, -30, -30, 60, 60, { borderRadius: '30px', background: 'rgba(20,24,42,.28)', border: '3px solid #fff', boxShadow: '0 0 0 1.5px rgba(20,24,42,.35),0 4px 12px rgba(0,0,0,.18)' }, '', 'c');
const ripples = CLICKS.map(() => { const e = D(stage, 0, 0, 0, 0, { borderRadius: '50%', border: `2.5px solid ${ACC}` }); e.style.zIndex = 49; return e; });
const touchK = trk(0, [[18.75, 1, 'soft'], [20.5, 0, 'soft']]);
const curVis = trk(0, [[0.5, 1], [26.5, 0]]);
U.push((t) => {
  const x = CUR.x(t), y = CUR.y(t);
  let press = 0;
  for (const [tc] of CLICKS) { const u = t - tc; if (u > -0.03 && u < 0.16) press = Math.max(press, Math.sin(Math.PI * (u + 0.03) / 0.19)); }
  for (const [a, b] of HOLDS) if (t >= a && t < b + 0.1) press = Math.max(press, Math.min(lin(t, a - 0.03, 0.06), 1 - lin(t, b, 0.1)));
  const tk = touchK(t), vis = curVis(t);
  curEl.style.transform = `translate(${x}px,${y}px)`;
  curEl.style.opacity = vis > 0.02 ? 1 : 0;
  arrow.style.transform = `translate(-2.8px,-2.8px) scale(${vis * (1 - 0.14 * press)})`;
  arrow.style.opacity = 1 - tk;
  touch.style.opacity = tk;
  touch.style.transform = `scale(${(0.6 + 0.4 * tk) * (1 - 0.2 * press)})`;
  CLICKS.forEach(([tc, isTouch], i) => {
    const e = ripples[i], u = t - tc;
    if (u < 0 || u > 0.45) { e.style.opacity = 0; return; }
    const rr = (isTouch ? 40 : 24) * spr(u, SP.soft);
    const cx = CUR.x(tc), cy = CUR.y(tc);
    put(e, cx - rr, cy - rr, 1, 0, 0.9 * (1 - lin(u, 0.1, 0.35)));
    size(e, rr * 2, rr * 2);
    e.style.borderColor = isTouch ? GRN : ACC;
  });
});

window.renderAt = (t) => { for (const f of U) f(t); };
window.__info = { TGT, CLICKS: CLICKS.map((c) => c[0]) };
window.renderAt(0);
