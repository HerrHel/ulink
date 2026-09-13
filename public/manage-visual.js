/*
 * 与链 ulink — 深度管理视觉「与主站卡片 100% 呼应的悬浮透光书签板」（/ 首页专用，Canvas 2D，零依赖）
 *
 * 与主站设计深度共鸣（Faithful Echo to ulink App UI）：
 * 1. 真实主卡片（BookmarkCard.vue & cards.css）：
 *    - 顶部 Header：.card-logo（圆角 8px Favicon 方盒，内置与链双环向量徽标）+ .card-name（标题）+ .pinned-badge（图钉徽标）+ .card-domain（等宽域名）+ .card-open-hint（↗ 外链提示）；
 *    - 真实属性标签：.card-tags（.tag-custom 胶囊「需要登录 / Login required」「AI」「开源项目 / Open source」）；
 *    - 真实摘要备注：.card-notes（双行备注文案）；
 *    - 真实子书签嵌套：.sub-sites 与 .group-inline-card（Favicon + 子站标题 + 域名 +「详情 / Details」按键），以 3D 景深层叠展开；
 *    - 真实底部操作栏：.card-foot（左侧鼠标指针 .card-stat「48 次点击 / 48 clicks」+ 右侧 .card-actions「+ 添加子站」「编辑」「删除」按键）；
 * 2. 真实设计令牌（tokens.css）：
 *    - 纯正取色：--surface (#FDFBF9)、--border (#E5DDD3)、--border-light (#EFE8DF)、--text (#2C2824)、--text-muted (#6A6660)、--accent (#122E8A)；
 * 3. 动态响应：
 *    - 支持主页语言无缝切换（跟随 document.documentElement.lang 即时切换中英文）；
 *    - 保持用户喜爱的悬浮透光玻璃材质（Frosted Glass）：边缘倒角高光、微弱菲涅尔棱镜彩虹折射、
 *      底层投射在 #F5EFEA 纸面的高阶弥散软阴影（Diffuse AO Shadow）与鼠标 3D 景深层叠视差（Parallax）。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('manage-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement;
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, DPR = 1;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false };
  var lastT = 0, rafId = 0, running = false, inView = true;

  function resize() {
    if (!wrapper) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = wrapper.clientWidth;
    H = wrapper.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reducedMotion) draw(0);
  }

  function drawRoundRect(c, x, y, w, h, r) {
    if (c.roundRect) {
      c.roundRect(x, y, w, h, r);
    } else {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.arcTo(x + w, y, x + w, y + r, r);
      c.lineTo(x + w, y + h - r);
      c.arcTo(x + w, y + h, x + w - r, y + h, r);
      c.lineTo(x + r, y + h);
      c.arcTo(x, y + h, x, y + h - r, r);
      c.lineTo(x, y + r);
      c.arcTo(x, y, x + r, y, r);
      c.closePath();
    }
  }

  // 绘制与链官方品牌矢量徽标（U-Knot 与字结）
  function drawUlinkLogo(c, cx, cy, r, bgColor) {
    c.save();
    c.translate(cx, cy);
    var s = r * 1.1;
    var lw = s * (26 / 120);
    var gapLw = s * (38 / 120);
    var bg = bgColor || '#EDE4DA';

    c.lineCap = 'round';
    c.lineJoin = 'round';

    var isDark = (function () {
      var dt = document.documentElement.getAttribute('data-theme');
      if (dt) return dt === 'dark';
      var looks = document.getElementById('looks');
      if (looks && looks.getAttribute('data-mode') === 'dark') return true;
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    })();
    var blueColor = isDark ? '#4F6BFF' : '#122E8A';
    var greenColor = isDark ? '#34D399' : '#10B981';

    // 1. Full Blue shape (G2 Bézier)
    c.strokeStyle = blueColor;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(-0.8 * s, -0.2 * s);
    c.lineTo(0, -0.2 * s);
    c.bezierCurveTo((7 / 15) * s, -0.2 * s, 0.6 * s, -(2 / 15) * s, 0.6 * s, 0.2 * s);
    c.bezierCurveTo(0.6 * s, (8 / 15) * s, (7 / 15) * s, 0.6 * s, 0, 0.6 * s);
    c.lineTo(-0.6 * s, 0.6 * s);
    c.stroke();

    // 2. Optical Gap at Crossing 2
    c.strokeStyle = bg;
    c.lineWidth = gapLw;
    c.beginPath();
    c.moveTo((53 / 120) * s, 0.2 * s);
    c.lineTo((91 / 120) * s, 0.2 * s);
    c.stroke();

    // 3. Full Green shape (G2 Bézier)
    c.strokeStyle = greenColor;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(0.8 * s, 0.2 * s);
    c.lineTo(0, 0.2 * s);
    c.bezierCurveTo(-(7 / 15) * s, 0.2 * s, -0.6 * s, (2 / 15) * s, -0.6 * s, -0.2 * s);
    c.bezierCurveTo(-0.6 * s, -(8 / 15) * s, -(7 / 15) * s, -0.6 * s, 0, -0.6 * s);
    c.lineTo(0.6 * s, -0.6 * s);
    c.stroke();

    // 4. Optical Gap at Crossing 1
    c.strokeStyle = bg;
    c.lineWidth = gapLw;
    c.beginPath();
    c.moveTo(-(91 / 120) * s, -0.2 * s);
    c.lineTo(-(53 / 120) * s, -0.2 * s);
    c.stroke();

    // 5. Seamless re-stroke Blue top line
    c.strokeStyle = blueColor;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(-0.8 * s, -0.2 * s);
    c.lineTo(0, -0.2 * s);
    c.stroke();

    c.restore();
  }

  // 绘制真实图钉 SVG 图标（I.pin 同款）
  function drawPinIcon(c, x, y, size, color) {
    c.save();
    c.fillStyle = color;
    c.translate(x, y);
    var s = size / 24;
    c.scale(s, s);
    c.beginPath();
    drawRoundRect(c, 4, 6, 16, 2.5, 1);
    c.fill();
    c.beginPath();
    c.moveTo(12, 11);
    c.lineTo(7, 19);
    c.lineTo(17, 19);
    c.closePath();
    c.fill();
    c.restore();
  }

  // 绘制外链打开提示图标（I.external ↗ 同款）
  function drawExternalIcon(c, x, y, size, color) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.translate(x, y);
    var s = size / 16;
    c.scale(s, s);
    c.beginPath();
    // 方框底座
    c.moveTo(12, 9); c.lineTo(12, 13); c.lineTo(3, 13); c.lineTo(3, 4); c.lineTo(7, 4);
    // 斜箭头
    c.moveTo(7, 9); c.lineTo(14, 2);
    c.moveTo(10, 2); c.lineTo(14, 2); c.lineTo(14, 6);
    c.stroke();
    c.restore();
  }

  // 绘制点击统计图标（I.click 指针同款）
  function drawClickIcon(c, x, y, size, color) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.translate(x, y);
    var s = size / 24;
    c.scale(s, s);
    c.beginPath();
    c.moveTo(15, 15);
    c.lineTo(13, 20);
    c.lineTo(9, 9);
    c.lineTo(20, 13);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(15, 15);
    c.lineTo(20, 20);
    c.stroke();
    c.restore();
  }

  // 绘制编辑笔图标（I.edit 同款）
  function drawEditIcon(c, x, y, size, color) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.translate(x, y);
    var s = size / 24;
    c.scale(s, s);
    c.beginPath();
    c.moveTo(11, 4); c.lineTo(4, 4); c.lineTo(4, 20); c.lineTo(20, 20); c.lineTo(20, 13);
    c.moveTo(18.5, 2.5); c.lineTo(21.5, 5.5); c.lineTo(12, 15); c.lineTo(8, 16); c.lineTo(9, 12); c.closePath();
    c.stroke();
    c.restore();
  }

  // 绘制垃圾桶图标（I.trash 同款）
  function drawTrashIcon(c, x, y, size, color) {
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.translate(x, y);
    var s = size / 24;
    c.scale(s, s);
    c.beginPath();
    c.moveTo(3, 6); c.lineTo(21, 6);
    c.moveTo(19, 6); c.lineTo(18, 20); c.lineTo(6, 20); c.lineTo(5, 6);
    c.moveTo(9, 6); c.lineTo(9, 3); c.lineTo(15, 3); c.lineTo(15, 6);
    c.stroke();
    c.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var S = Math.min(W, H);
    if (S <= 0) return;
    var cx = W / 2;
    var cy = H / 2;

    // 语言检测（即时响应 landing.js 的双语切换）
    var isEn = document.documentElement.lang === 'en-US';

    // 视差惯性追踪
    pointer.x += (pointer.tx - pointer.x) * 0.08;
    pointer.y += (pointer.ty - pointer.y) * 0.08;

    // 比例缩放基准（整体放大比例）
    var sc = Math.max(0.85, Math.min(1.35, S / 365));

    // ── 1. 主书签卡片空间位置（Parent Bookmark Card，整体放大）──
    var pBob = Math.sin(t * 1.3) * 4;
    var pParallaxX = pointer.x * 10;
    var pParallaxY = pointer.y * 8;

    var pw = Math.round(S * 0.72);
    var ph = Math.round(S * 0.53);
    var px = cx - S * 0.10 + pParallaxX;
    var py = cy - S * 0.15 + pBob + pParallaxY;
    var pTilt = -0.03 + pointer.x * 0.02;

    // ── 2. 子书签 1 空间位置（Child 1: 宣传页 Landing Page，整体放大）──
    var c1Bob = Math.sin(t * 1.3 + 1.6) * 5;
    var c1ParallaxX = pointer.x * 20;
    var c1ParallaxY = pointer.y * 16;

    var c1w = Math.round(S * 0.58);
    var c1h = Math.round(S * 0.19);
    var c1x = cx + S * 0.13 + c1ParallaxX;
    var c1y = cy + S * 0.11 + c1Bob + c1ParallaxY;
    var c1Tilt = 0.03 + pointer.x * 0.03;

    // ── 3. 子书签 2 空间位置（Child 2: 应用端 Web App，整体放大）──
    var c2Bob = Math.sin(t * 1.3 + 3.0) * 6;
    var c2ParallaxX = pointer.x * 28;
    var c2ParallaxY = pointer.y * 22;

    var c2w = Math.round(S * 0.57);
    var c2h = Math.round(S * 0.19);
    var c2x = cx + S * 0.17 + c2ParallaxX;
    var c2y = cy + S * 0.31 + c2Bob + c2ParallaxY;
    var c2Tilt = 0.05 + pointer.x * 0.04;

    // ── 4. 树状嵌套连接分支（Tree Branch Connectors）──
    var startX = px + pw * 0.18;
    var startY = py + ph * 0.32;
    var target1X = c1x - c1w * 0.48;
    var target1Y = c1y;
    var target2X = c2x - c2w * 0.48;
    var target2Y = c2y;
    var forkX = px + pw * 0.38;
    var forkY = (startY + target1Y) / 2;

    ctx.save();
    ctx.lineWidth = 1.8;

    var treeGrad1 = ctx.createLinearGradient(startX, startY, target1X, target1Y);
    treeGrad1.addColorStop(0, 'rgba(18, 46, 138, 0.35)');
    treeGrad1.addColorStop(0.5, 'rgba(79, 124, 255, 0.45)');
    treeGrad1.addColorStop(1, 'rgba(16, 185, 129, 0.55)');

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(forkX, startY, forkX, target1Y, target1X, target1Y);
    ctx.strokeStyle = treeGrad1;
    ctx.stroke();

    var treeGrad2 = ctx.createLinearGradient(forkX, forkY, target2X, target2Y);
    treeGrad2.addColorStop(0, 'rgba(79, 124, 255, 0.35)');
    treeGrad2.addColorStop(1, 'rgba(18, 46, 138, 0.55)');

    ctx.beginPath();
    ctx.moveTo(forkX, forkY);
    ctx.bezierCurveTo(forkX + 22, forkY + 26, forkX, target2Y, target2X, target2Y);
    ctx.strokeStyle = treeGrad2;
    ctx.stroke();

    // 脉冲能量光点流向子卡
    var pulseT = (t * 0.5) % 1;
    var p1x = (1 - pulseT) * startX + pulseT * target1X;
    var p1y = (1 - pulseT) * startY + pulseT * target1Y;
    ctx.fillStyle = '#4F7CFF';
    ctx.beginPath(); ctx.arc(p1x, p1y, 2.6, 0, Math.PI * 2); ctx.fill();

    var pulse2T = ((t * 0.5) + 0.4) % 1;
    var p2x = (1 - pulse2T) * forkX + pulse2T * target2X;
    var p2y = (1 - pulse2T) * forkY + pulse2T * target2Y;
    ctx.fillStyle = '#10B981';
    ctx.beginPath(); ctx.arc(p2x, p2y, 2.2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    // ── 5. 渲染主卡片（Parent BookmarkCard.vue）──
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(pTilt);

    // 多重环境光弥散遮蔽软阴影（Diffuse AO Shadow）
    ctx.shadowColor = 'rgba(28, 24, 20, 0.12)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.beginPath();
    drawRoundRect(ctx, -pw / 2, -ph / 2, pw, ph, 14);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // 玻璃板本体磨砂微透光渐变（呼应主站 var(--surface) #FDFBF9）
    var gGradP = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    gGradP.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
    gGradP.addColorStop(0.6, 'rgba(253, 251, 249, 0.90)');
    gGradP.addColorStop(1, 'rgba(245, 239, 234, 0.92)');
    ctx.fillStyle = gGradP;
    ctx.beginPath();
    drawRoundRect(ctx, -pw / 2, -ph / 2, pw, ph, 14);
    ctx.fill();

    // 倒角微光边框（呼应主站 var(--border) #E5DDD3 与透光棱镜彩虹）
    ctx.lineWidth = 1.4;
    var rGradP = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    rGradP.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
    rGradP.addColorStop(0.3, 'rgba(142, 168, 255, 0.42)');
    rGradP.addColorStop(0.7, 'rgba(16, 185, 129, 0.32)');
    rGradP.addColorStop(1, 'rgba(229, 221, 211, 0.92)');
    ctx.strokeStyle = rGradP;
    ctx.stroke();

    // ── 主卡 Header（.card-toprow）──
    var topY = -ph / 2 + 16;

    // 1. .card-logo（圆角 8px Favicon 方盒）
    var logoSize = Math.round(36 * sc);
    var logoX = -pw / 2 + 16;
    ctx.fillStyle = '#EDE4DA'; // 主站 var(--bg-alt)
    ctx.beginPath();
    drawRoundRect(ctx, logoX, topY, logoSize, logoSize, 8);
    ctx.fill();
    ctx.strokeStyle = '#EFE8DF'; // 主站 var(--border-light)
    ctx.lineWidth = 1;
    ctx.stroke();

    // Logo 内置与链双环向量徽标
    drawUlinkLogo(ctx, logoX + logoSize / 2, topY + logoSize / 2, logoSize * 0.32);

    // 2. .card-titlewrap-text
    var textX = logoX + logoSize + 10;
    var titleText = isEn ? 'ulink' : '与链 ulink';

    // 标题
    ctx.fillStyle = '#2C2824'; // 主站 var(--text)
    ctx.font = '600 ' + Math.round(13 * sc) + 'px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(titleText, textX, topY + Math.round(13 * sc));

    // .pinned-badge（主站置顶蓝色图钉）
    var titleW = ctx.measureText(titleText).width;
    drawPinIcon(ctx, textX + titleW + 6, topY + 1, Math.round(13 * sc), '#3B82F6');

    // 域名（.card-domain，JetBrains Mono / monospace）
    ctx.fillStyle = '#6A6660'; // 主站 var(--text-muted)
    ctx.font = Math.round(10 * sc) + 'px "JetBrains Mono",monospace';
    ctx.fillText('ulink.ren', textX, topY + Math.round(28 * sc));

    // 外链打开提示图标（.card-open-hint ↗）
    var hintX = pw / 2 - 26;
    drawExternalIcon(ctx, hintX, topY + 4, Math.round(13 * sc), '#9B968E');

    // ── 主卡 Body ──
    // 3. 属性标签行（.card-tags -> .tag-custom）
    var tagsY = topY + logoSize + 10;

    // 标签 1：「离线优先」/「Offline first」
    var t1Text = isEn ? 'Offline first' : '离线优先';
    ctx.font = '600 ' + Math.round(9 * sc) + 'px sans-serif';
    var t1W = ctx.measureText(t1Text).width + 16;
    ctx.fillStyle = 'rgba(13, 122, 111, 0.08)'; // 主站 green-light
    ctx.beginPath(); drawRoundRect(ctx, -pw / 2 + 16, tagsY, t1W, 18, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(13, 122, 111, 0.22)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = '#0d7a6f'; ctx.textAlign = 'center';
    ctx.fillText(t1Text, -pw / 2 + 16 + t1W / 2, tagsY + 12);

    // 标签 2：「端到端加密」/「E2E Encrypted」
    var t2Text = isEn ? 'E2E Encrypted' : '端到端加密';
    var t2X = -pw / 2 + 16 + t1W + 6;
    var t2W = ctx.measureText(t2Text).width + 16;
    ctx.fillStyle = 'rgba(30, 64, 175, 0.08)';
    ctx.beginPath(); drawRoundRect(ctx, t2X, tagsY, t2W, 18, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(30, 64, 175, 0.22)'; ctx.stroke();
    ctx.fillStyle = '#1E40AF'; ctx.fillText(t2Text, t2X + t2W / 2, tagsY + 12);

    // 标签 3：「免注册」/「No sign-up」
    var t3Text = isEn ? 'No sign-up' : '免注册';
    var t3X = t2X + t2W + 6;
    var t3W = ctx.measureText(t3Text).width + 16;
    ctx.fillStyle = '#EDE5DB'; // 主站 var(--card-badge-bg)
    ctx.beginPath(); drawRoundRect(ctx, t3X, tagsY, t3W, 18, 9); ctx.fill();
    ctx.strokeStyle = 'rgba(229, 221, 211, 0.9)'; ctx.stroke();
    ctx.fillStyle = '#5E5852'; // 主站 var(--text-secondary)
    ctx.fillText(t3Text, t3X + t3W / 2, tagsY + 12);

    // 4. 备注预览文本（.card-notes）
    var notesY = tagsY + 25;
    ctx.fillStyle = '#6A6660';
    ctx.font = Math.round(9.5 * sc) + 'px sans-serif';
    ctx.textAlign = 'left';
    var notesText = isEn
      ? 'Official ulink portals: landing presentation & zero-config web application.'
      : '与链官方双端入口：宣传展示页与免注册即用 Web 应用端。';
    ctx.fillText(notesText, -pw / 2 + 16, notesY + 10);

    // 5. 子书签挂载指引区（.sub-sites 提示条）
    var subHintY = notesY + 20;
    ctx.fillStyle = 'rgba(18, 46, 138, 0.05)';
    ctx.beginPath();
    drawRoundRect(ctx, -pw / 2 + 16, subHintY, pw - 32, 22, 6);
    ctx.fill();

    ctx.fillStyle = '#122E8A';
    ctx.font = '600 ' + Math.round(9 * sc) + 'px sans-serif';
    var subHintText = isEn ? '↳ 2 core portal entrances mounted' : '↳ 已挂载 2 个官方核心入口';
    ctx.fillText(subHintText, -pw / 2 + 26, subHintY + 14);

    // ── 主卡 Footer（.card-foot）──
    var footY = ph / 2 - 30;
    ctx.strokeStyle = 'rgba(239, 232, 223, 0.95)'; // 主站 var(--border-light)
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-pw / 2 + 14, footY);
    ctx.lineTo(pw / 2 - 14, footY);
    ctx.stroke();

    // 点击统计（.card-stat，鼠标指针图标 + 次数）
    var icX = -pw / 2 + 18, icY = footY + 7;
    drawClickIcon(ctx, icX, icY, 13, '#6A6660');

    ctx.fillStyle = '#6A6660';
    ctx.font = Math.round(9.5 * sc) + 'px sans-serif';
    var statText = isEn ? '128 clicks' : '128 次点击';
    ctx.fillText(statText, icX + 16, footY + 17);

    // 右侧操作按键（.card-actions: + 添加子站 / ✏️ 编辑 / 🗑️ 删除）
    var actRight = pw / 2 - 18;

    // 1. 删除垃圾桶（btn-danger）
    drawTrashIcon(ctx, actRight - 12, footY + 7, 13, '#dc2626');

    // 2. 编辑笔
    drawEditIcon(ctx, actRight - 32, footY + 7, 13, '#6A6660');

    // 3. 添加子站（+ 号）
    ctx.strokeStyle = '#122E8A';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(actRight - 50, footY + 13); ctx.lineTo(actRight - 42, footY + 13);
    ctx.moveTo(actRight - 46, footY + 9); ctx.lineTo(actRight - 46, footY + 17);
    ctx.stroke();

    // 表面动态高光扫光
    var sheenP = (t * 0.35) % 3.2;
    if (sheenP < 1.0) {
      var sheenX = -pw + sheenP * (pw * 2);
      var sGrad = ctx.createLinearGradient(sheenX, -ph / 2, sheenX + 50, ph / 2);
      sGrad.addColorStop(0, 'rgba(255,255,255,0)');
      sGrad.addColorStop(0.5, 'rgba(255,255,255,0.24)');
      sGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sGrad;
      ctx.beginPath(); drawRoundRect(ctx, -pw / 2, -ph / 2, pw, ph, 14); ctx.fill();
    }

    ctx.restore();

    // ── 6. 渲染子书签 1（呼应主站 .group-inline-card）──
    ctx.save();
    ctx.translate(c1x, c1y);
    ctx.rotate(c1Tilt);

    ctx.shadowColor = 'rgba(28, 24, 20, 0.12)';
    ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.beginPath(); drawRoundRect(ctx, -c1w / 2, -c1h / 2, c1w, c1h, 10); ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(229, 221, 211, 0.95)';
    ctx.stroke();

    // 宣传页 Icon 方盒（全球门户 / Web Portal）
    ctx.fillStyle = '#1D4ED8';
    ctx.beginPath(); drawRoundRect(ctx, -c1w / 2 + 12, -13, 26, 26, 6); ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(-c1w / 2 + 25, 0, 7.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-c1w / 2 + 25, 0, 3.5, 7.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-c1w / 2 + 17.5, 0); ctx.lineTo(-c1w / 2 + 32.5, 0); ctx.stroke();

    // 标题与域名
    var c1Title = isEn ? 'Landing Page' : '宣传页';
    ctx.fillStyle = '#2C2824';
    ctx.font = '600 ' + Math.round(11 * sc) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(c1Title, -c1w / 2 + 46, -3);

    ctx.fillStyle = '#6A6660';
    ctx.font = Math.round(9 * sc) + 'px "JetBrains Mono",monospace';
    ctx.fillText('ulink.ren', -c1w / 2 + 46, 11);

    // 右侧「详情 / Details」按键（呼应主站 .gic-btn）
    var btn1Text = isEn ? 'Details' : '详情';
    ctx.font = '700 ' + Math.round(9 * sc) + 'px sans-serif';
    var btn1W = ctx.measureText(btn1Text).width + 12;
    var btn1X = c1w / 2 - btn1W - 12;
    ctx.fillStyle = 'rgba(18, 46, 138, 0.08)'; // 主站 var(--accent-light)
    ctx.beginPath(); drawRoundRect(ctx, btn1X, -10, btn1W, 20, 5); ctx.fill();
    ctx.fillStyle = '#122E8A'; // 主站 var(--accent)
    ctx.textAlign = 'center';
    ctx.fillText(btn1Text, btn1X + btn1W / 2, 3);

    ctx.restore();

    // ── 7. 渲染子书签 2（呼应主站 .group-inline-card）──
    ctx.save();
    ctx.translate(c2x, c2y);
    ctx.rotate(c2Tilt);

    ctx.shadowColor = 'rgba(28, 24, 20, 0.11)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.beginPath(); drawRoundRect(ctx, -c2w / 2, -c2h / 2, c2w, c2h, 10); ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(229, 221, 211, 0.95)';
    ctx.stroke();

    // 应用端 Icon 方盒（桌面应用 / Web App）
    ctx.fillStyle = '#0F172A';
    ctx.beginPath(); drawRoundRect(ctx, -c2w / 2 + 12, -13, 26, 26, 6); ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(-c2w / 2 + 18, -6.5, 14, 13);
    ctx.beginPath(); ctx.moveTo(-c2w / 2 + 18, -2); ctx.lineTo(-c2w / 2 + 32, -2); ctx.stroke();
    ctx.fillStyle = '#60A5FA';
    ctx.beginPath(); ctx.arc(-c2w / 2 + 20.5, -4.2, 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#34D399';
    ctx.beginPath(); ctx.arc(-c2w / 2 + 23.5, -4.2, 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F87171';
    ctx.beginPath(); ctx.arc(-c2w / 2 + 26.5, -4.2, 1, 0, Math.PI * 2); ctx.fill();

    // 标题与域名
    var c2Title = isEn ? 'Web App' : '应用端';
    ctx.fillStyle = '#2C2824';
    ctx.font = '600 ' + Math.round(11 * sc) + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(c2Title, -c2w / 2 + 46, -3);

    ctx.fillStyle = '#6A6660';
    ctx.font = Math.round(9 * sc) + 'px "JetBrains Mono",monospace';
    ctx.fillText('ulink.ren/app', -c2w / 2 + 46, 11);

    // 右侧「详情 / Details」按键
    var btn2Text = isEn ? 'Details' : '详情';
    ctx.font = '700 ' + Math.round(9 * sc) + 'px sans-serif';
    var btn2W = ctx.measureText(btn2Text).width + 12;
    var btn2X = c2w / 2 - btn2W - 12;
    ctx.fillStyle = 'rgba(18, 46, 138, 0.08)';
    ctx.beginPath(); drawRoundRect(ctx, btn2X, -10, btn2W, 20, 5); ctx.fill();
    ctx.fillStyle = '#122E8A';
    ctx.textAlign = 'center';
    ctx.fillText(btn2Text, btn2X + btn2W / 2, 3);

    ctx.restore();
  }

  function frame(ts) {
    if (!running) return;
    var dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    var t = ts / 1000;
    draw(t);
    rafId = requestAnimationFrame(frame);
  }

  function play() {
    if (running || reducedMotion) return;
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.tx = ((e.clientX - rect.left) / Math.max(1, W) - 0.5) * 2;
    pointer.ty = ((e.clientY - rect.top) / Math.max(1, H) - 0.5) * 2;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.tx = 0;
    pointer.ty = 0;
    pointer.active = false;
  }

  function start() {
    resize();
    if (reducedMotion) return;

    var host = canvas.closest('.sect') || wrapper;
    if (host) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
    }

    if ('IntersectionObserver' in window) {
      inView = true;
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView && !document.hidden) play(); else pause();
      }, { threshold: 0.02 }).observe(canvas);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
      else if (inView) play();
    });

    var timer = 0;
    var onResize = function () {
      clearTimeout(timer);
      timer = setTimeout(resize, 150);
    };
    if ('ResizeObserver' in window && wrapper) new ResizeObserver(onResize).observe(wrapper);
    else window.addEventListener('resize', onResize);

    play();
  }

  start();
})();
