/*
 * 与链 ulink — 创作与分享视觉「行星环绕式 · 知识引力系统」（/ 首页专用，Canvas 2D，零依赖）
 *
 * 设计主旨（Faithful to ulink Brand & Visual Hierarchy）：
 * 1. 【中央恒星核心（纯粹经典分享徽章）】：
 *    - 纯正光学绝对居中校准的经典 3 节点分支分享图腾，流光在分支间脉动，白玉光芯微闪；
 *    - 悬浮透光玻璃圆球徽章，带有翡翠绿 (#10B981) 与深湛蓝 (#122E8A) 的双色倒角高光与微折射晶核；
 *    - 作为天体引力源，持续向外荡漾舒缓的同心引力波。
 * 2. 【多层环绕天体集群（多维设备与伴生微卫星）】：
 *    - 8 颗天体沿多层嵌套椭圆轨道运行，快慢交织，涵盖移动端星、带环桌面星、平板星与晶莹伴生小星；
 *    - 真实 3D 前后景深（Z-Index）：飞掠中央徽标背面时受引力遮蔽并柔和隐匿，掠过正前方时放大高亮；
 *    - 拖曳星尘彗尾粒子流，与中央分享徽章之间拉出微弱的引力光丝。
 * 3. 【严选统一品牌色谱】：
 *    - 严格萃取与链品牌色系：翡翠绿 (#10B981)、科技湛蓝 (#4F6BFF / #1E40AF)、极光青 (#2DD4BF) 与冰透白 (#E2E8F0)；
 *    - 杜绝突兀杂色，与页面底色（#F5EFEA 与 #1A1A1D）浑然一体。
 * 4. 【沉稳微视差与点击交互】：
 *    - 阻尼系数深度校准至 0.038，平移位移 ±3.8px，轨道俯仰 0.024 弧度，稳健如岳；
 *    - 点击中央徽标向全星系激荡翡翠绿引力冲击光波。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('share-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement;
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, DPR = 1, sc = 1;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false };
  var lastT = 0, rafId = 0, running = false, inView = true;

  var shockwaves = [];
  var corePulse = 0;



  // ── 6 颗精选代表性天体（数码设备与微晶穿插，节奏优雅、极简精工）──
  var planets = [
    // 0: 移动手机端（近轨道，纯正翡翠绿，微型手机形态）
    { id: 'mobile', orbitA: 104, orbitB: 60, speed: 0.44, theta: 0.6, w: 22, h: 36, r: 5, tilt: -0.12, color: '#10B981', type: 'mobile', trail: [], hover: 0 },
    // 1: 极简伴生微星 A（近中轨道，极光青晶体）
    { id: 'crystal_a', orbitA: 140, orbitB: 82, speed: -0.52, theta: 3.2, w: 8, h: 8, r: 4, tilt: 0, color: '#2DD4BF', type: 'orb', trail: [], hover: 0 },
    // 2: 开发者桌面端（中轨道，科技湛蓝，微型显示器与窗口形态）
    { id: 'desktop', orbitA: 178, orbitB: 104, speed: 0.32, theta: 1.8, w: 42, h: 28, r: 4, tilt: 0.10, color: '#4F6BFF', type: 'desktop', trail: [], hover: 0 },
    // 3: 澄澈伴生小星 B（中外轨道，冰蓝微晶）
    { id: 'crystal_b', orbitA: 202, orbitB: 118, speed: 0.38, theta: 5.4, w: 9, h: 9, r: 4.5, tilt: 0, color: '#60A5FA', type: 'orb', trail: [], hover: 0 },
    // 4: 平板阅读端（外轨道，薄荷青绿，双栏卡片微排版）
    { id: 'tablet', orbitA: 228, orbitB: 132, speed: -0.26, theta: 4.5, w: 34, h: 24, r: 4, tilt: -0.06, color: '#059669', type: 'tablet', trail: [], hover: 0 },
    // 5: 公开知识库 / 社区大星（大外轨道，多重同心刻度晶盘）
    { id: 'community', orbitA: 258, orbitB: 150, speed: 0.18, theta: 0.2, w: 30, h: 30, r: 15, tilt: 0.16, color: '#10B981', type: 'community', trail: [], hover: 0 }
  ];

  function getIsDark() {
    var dt = document.documentElement.getAttribute('data-theme');
    return dt === 'dark';
  }

  function resize() {
    if (!wrapper) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    sc = Math.min(wrapper.clientWidth / 480, wrapper.clientHeight / 400);
    sc = Math.max(0.85, Math.min(sc, 1.25));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reducedMotion) renderFrame(0, 0);
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
      c.lineTo(x + r, y);
      c.arcTo(x, y, x + r, y, r);
      c.closePath();
    }
  }

  // 【光学绝对居中】绘制经典 3 节点分享图标（内蕴脉动数据流光，象征知识向多端分发）
  function drawClassicShareIcon(c, cx, cy, size, isDark, t) {
    c.save();
    c.translate(cx, cy);

    var s = size;
    var optOffsetX = -s * 0.045;

    var rootX = -s * 0.35 + optOffsetX, rootY = 0;
    var topX = s * 0.35 + optOffsetX,  topY = -s * 0.38;
    var btmX = s * 0.35 + optOffsetX,  btmY = s * 0.38;
    var nodeR = s * 0.14;

    // 1. 分支骨架线
    c.strokeStyle = isDark ? '#34D399' : '#10B981';
    c.lineWidth = s * 0.11;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    c.beginPath();
    c.moveTo(rootX, rootY);
    c.lineTo(topX, topY);
    c.stroke();

    c.beginPath();
    c.moveTo(rootX, rootY);
    c.lineTo(btmX, btmY);
    c.stroke();

    // 2. 周期性从根节点向分支推送的【分享微光子流】（周期 2.4s）
    var cycle = (t * 0.001) % 2.4;
    var photonProg = cycle < 1.1 ? cycle / 1.1 : -1;
    var branchFlash = 0;

    if (photonProg >= 0) {
      var px1 = rootX + (topX - rootX) * photonProg;
      var py1 = rootY + (topY - rootY) * photonProg;
      var px2 = rootX + (btmX - rootX) * photonProg;
      var py2 = rootY + (btmY - rootY) * photonProg;

      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.arc(px1, py1, s * 0.065, 0, Math.PI * 2);
      c.arc(px2, py2, s * 0.065, 0, Math.PI * 2);
      c.fill();

      if (photonProg > 0.8) {
        branchFlash = (photonProg - 0.8) / 0.2;
      }
    }

    // 3. 绘制 3 个晶透节点
    var nodes = [
      { x: rootX, y: rootY, r: nodeR * 1.05, flash: 0 },
      { x: topX, y: topY, r: nodeR * (1 + branchFlash * 0.2), flash: branchFlash },
      { x: btmX, y: btmY, r: nodeR * (1 + branchFlash * 0.2), flash: branchFlash }
    ];

    for (var n = 0; n < nodes.length; n++) {
      var nd = nodes[n];
      c.fillStyle = '#FFFFFF';
      c.beginPath();
      c.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
      c.fill();

      c.strokeStyle = nd.flash > 0 ? (isDark ? '#6EE7B7' : '#059669') : (isDark ? '#10B981' : '#0D7A6F');
      c.lineWidth = s * (0.06 + nd.flash * 0.03);
      c.stroke();
    }

    c.restore();
  }

  function hexToRgba(hex, alpha) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var num = parseInt(c, 16);
    var r = (num >> 16) & 255;
    var g = (num >> 8) & 255;
    var b = num & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(3) + ')';
  }

  // 绘制行星与中央主核之间的【引力羁绊连接线】（微透光纤光带 + 边缘微锚点）
  function renderTether(p, cx, cy, coreR, sc, isDark) {
    var dx = p.x - cx;
    var dy = p.y - cy;
    var dist = Math.hypot(dx, dy);
    if (dist <= coreR) return;

    var ratio = coreR / dist;
    var sx = cx + dx * ratio;
    var sy = cy + dy * ratio;

    ctx.save();

    var baseAlpha = (isDark ? 0.22 : 0.16) * p.alpha;
    var hoverBoost = p.hover * 0.42;
    var alpha1 = Math.min(0.85, baseAlpha + hoverBoost);
    var alpha2 = Math.min(0.85, (isDark ? 0.38 : 0.28) * p.alpha + hoverBoost);

    var grad = ctx.createLinearGradient(sx, sy, p.x, p.y);
    var coreColor = isDark ? 'rgba(52, 211, 153, ' : 'rgba(16, 185, 129, ';

    grad.addColorStop(0, coreColor + alpha1.toFixed(3) + ')');
    grad.addColorStop(0.5, coreColor + (alpha1 * 0.55).toFixed(3) + ')');
    grad.addColorStop(1, hexToRgba(p.color, alpha2));

    ctx.strokeStyle = grad;
    ctx.lineWidth = (0.95 + p.hover * 0.8) * sc;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    // 中央主核边缘外接微锚点（精密工程质感，随天体公转在圆环边缘滑动）
    var anchorR = (1.2 + p.hover * 0.6) * sc;
    ctx.fillStyle = hexToRgba(p.color, Math.min(0.9, alpha2 * 1.25));
    ctx.beginPath();
    ctx.arc(sx, sy, anchorR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 绘制正中央【纯粹透光 · 极简经典分享徽章】
  function renderCentralShareCore(cx, cy, coreR, sc, t, isDark) {
    ctx.save();

    // 1. 微弱柔和的环境呼吸晕光
    var aura = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, coreR * 1.6);
    aura.addColorStop(0, isDark ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.12)');
    aura.addColorStop(0.6, isDark ? 'rgba(18, 46, 138, 0.08)' : 'rgba(18, 46, 138, 0.04)');
    aura.addColorStop(1, 'transparent');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // 2. 正圆透光磨砂徽章底板
    ctx.shadowColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(44, 40, 36, 0.09)';
    ctx.shadowBlur = 12 * sc;
    ctx.shadowOffsetY = 3 * sc;

    ctx.fillStyle = isDark ? '#23252E' : '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // 3. 极细精致边框
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.16)' : '#E5DDD3';
    ctx.lineWidth = 1.3 * sc;
    ctx.stroke();

    // 4. 居中经典分享图腾（带流动微光子）
    drawClassicShareIcon(ctx, cx, cy, coreR * 1.05, isDark, t);

    ctx.restore();
  }

  // 绘制单颗天体（具有微缩精工质感的真实形态）
  function renderPlanet(p, cx, cy, sc, t, isDark) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);

    var scale = p.scale * (1 + p.hover * 0.12);
    var w = p.w * sc * scale;
    var h = p.h * sc * scale;
    var rad = p.r * sc * scale;

    // 1. 伴生晶体微星 (orb)
    if (p.type === 'orb') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(-rad * 0.3, -rad * 0.3, rad * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 2. 公开知识库大星 (community hub)
    if (p.type === 'community') {
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(44, 40, 36, 0.08)';
      ctx.shadowBlur = 8 * sc;
      ctx.shadowOffsetY = 2 * sc;

      ctx.fillStyle = isDark ? '#23252E' : '#FFFFFF';
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : '#E5DDD3';
      ctx.lineWidth = 1.2 * sc;
      ctx.stroke();

      // 内层翡翠绿同心环
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1 * sc;
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.65, 0, Math.PI * 2);
      ctx.stroke();

      // 中心晶核
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.28, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return;
    }

    // 3. 开发者桌面设备 (desktop)
    if (p.type === 'desktop') {
      // 支架底座
      ctx.fillStyle = isDark ? '#3D3F4C' : '#D1C7BA';
      ctx.fillRect(-7 * sc * scale, h / 2, 14 * sc * scale, 2.5 * sc * scale);
      ctx.fillRect(-2 * sc * scale, h / 2 - 1.5 * sc * scale, 4 * sc * scale, 2 * sc * scale);

      // 显示器主体
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(44, 40, 36, 0.08)';
      ctx.shadowBlur = 8 * sc;
      ctx.shadowOffsetY = 2 * sc;
      ctx.fillStyle = isDark ? '#23252E' : '#FFFFFF';
      ctx.beginPath();
      drawRoundRect(ctx, -w / 2, -h / 2, w, h, rad);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : '#E5DDD3';
      ctx.lineWidth = 1 * sc;
      ctx.stroke();

      // macOS 风格 3 色微红绿灯
      var dotY = -h / 2 + 4.2 * sc * scale;
      var dotLeft = -w / 2 + 4.5 * sc * scale;
      var dotSpacing = 3.6 * sc * scale;
      var dotR = 1.1 * sc * scale;

      ctx.fillStyle = '#EF4444'; ctx.beginPath(); ctx.arc(dotLeft, dotY, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F59E0B'; ctx.beginPath(); ctx.arc(dotLeft + dotSpacing, dotY, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10B981'; ctx.beginPath(); ctx.arc(dotLeft + dotSpacing * 2, dotY, dotR, 0, Math.PI * 2); ctx.fill();

      // 屏幕内书签卡片预览（科技蓝微卡块 + 2 条内容线）
      var cardX = -w / 2 + 4 * sc * scale;
      var cardY = -h / 2 + 8.5 * sc * scale;
      var cardW = w - 8 * sc * scale;
      var cardH = h - 13 * sc * scale;

      ctx.fillStyle = isDark ? '#2C2E3B' : '#F5EFEA';
      ctx.beginPath();
      drawRoundRect(ctx, cardX, cardY, cardW, cardH, 2 * sc);
      ctx.fill();

      ctx.fillStyle = p.color;
      ctx.fillRect(cardX + 2.5 * sc * scale, cardY + 2.5 * sc * scale, 3 * sc * scale, 3 * sc * scale);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(44,40,36,0.3)';
      ctx.fillRect(cardX + 7.5 * sc * scale, cardY + 3 * sc * scale, cardW - 10.5 * sc * scale, 1.8 * sc * scale);

      ctx.restore();
      return;
    }

    // 4. 移动手机端 (mobile)
    if (p.type === 'mobile') {
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(44, 40, 36, 0.08)';
      ctx.shadowBlur = 8 * sc;
      ctx.shadowOffsetY = 2 * sc;
      ctx.fillStyle = isDark ? '#23252E' : '#FFFFFF';
      ctx.beginPath();
      drawRoundRect(ctx, -w / 2, -h / 2, w, h, rad);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : '#E5DDD3';
      ctx.lineWidth = 1 * sc;
      ctx.stroke();

      // 顶部听筒 / 灵动岛条
      ctx.fillStyle = isDark ? '#3D3F4C' : '#D1C7BA';
      ctx.beginPath();
      drawRoundRect(ctx, -3.5 * sc * scale, -h / 2 + 2.5 * sc * scale, 7 * sc * scale, 1.2 * sc * scale, 0.6 * sc);
      ctx.fill();

      // 2 条手机书签条
      var mPadX = 3 * sc * scale;
      var mCardW = w - mPadX * 2;
      for (var mi = 0; mi < 2; mi++) {
        var my = -h / 2 + (7 + mi * 11) * sc * scale;
        ctx.fillStyle = isDark ? '#2C2E3B' : '#F5EFEA';
        ctx.beginPath();
        drawRoundRect(ctx, -w / 2 + mPadX, my, mCardW, 8 * sc * scale, 1.5 * sc);
        ctx.fill();

        ctx.fillStyle = p.color;
        ctx.fillRect(-w / 2 + mPadX + 2 * sc * scale, my + 2.5 * sc * scale, 3 * sc * scale, 3 * sc * scale);
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(44,40,36,0.25)';
        ctx.fillRect(-w / 2 + mPadX + 6.5 * sc * scale, my + 3 * sc * scale, mCardW - 9 * sc * scale, 1.6 * sc * scale);
      }

      ctx.restore();
      return;
    }

    // 5. 平板阅读端 (tablet)
    if (p.type === 'tablet') {
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(44, 40, 36, 0.08)';
      ctx.shadowBlur = 8 * sc;
      ctx.shadowOffsetY = 2 * sc;
      ctx.fillStyle = isDark ? '#23252E' : '#FFFFFF';
      ctx.beginPath();
      drawRoundRect(ctx, -w / 2, -h / 2, w, h, rad);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.14)' : '#E5DDD3';
      ctx.lineWidth = 1 * sc;
      ctx.stroke();

      // 平板左侧微栏目 + 右侧双格卡片
      var tPad = 3 * sc * scale;
      var sideW = 6 * sc * scale;
      ctx.fillStyle = isDark ? '#2C2E3B' : '#F5EFEA';
      ctx.fillRect(-w / 2 + tPad, -h / 2 + tPad, sideW, h - tPad * 2);

      var rightX = -w / 2 + tPad + sideW + 2 * sc * scale;
      var rightW = w - tPad * 2 - sideW - 2 * sc * scale;
      for (var ti = 0; ti < 2; ti++) {
        var ty = -h / 2 + tPad + ti * 9 * sc * scale;
        ctx.fillStyle = isDark ? '#2C2E3B' : '#F5EFEA';
        ctx.beginPath();
        drawRoundRect(ctx, rightX, ty, rightW, 7 * sc * scale, 1.5 * sc);
        ctx.fill();
        ctx.fillStyle = p.color;
        ctx.fillRect(rightX + 2 * sc * scale, ty + 2 * sc * scale, 3 * sc * scale, 3 * sc * scale);
      }

      ctx.restore();
      return;
    }

    ctx.restore();
  }

  function renderFrame(t, dt) {
    pointer.x += (pointer.tx - pointer.x) * 0.038;
    pointer.y += (pointer.ty - pointer.y) * 0.038;

    if (corePulse > 0) {
      corePulse -= dt * 1.8;
      if (corePulse < 0) corePulse = 0;
    }

    ctx.clearRect(0, 0, W, H);

    var isDark = getIsDark();
    var sc = Math.min(wrapper.clientWidth / 480, wrapper.clientHeight / 400);
    sc = Math.max(0.85, Math.min(sc, 1.25));

    var cx = W / 2 + pointer.x * 3.8;
    var cy = H / 2 + pointer.y * 3.8;

    var orbitTilt = -0.24 + pointer.y * 0.024;

    // 1. 极简秩序天球轨道环（发丝级细线）
    ctx.save();
    var orbitR = [104, 140, 178, 228, 258];
    ctx.strokeStyle = isDark ? 'rgba(52, 211, 153, 0.08)' : 'rgba(18, 46, 138, 0.06)';
    ctx.lineWidth = 1 * sc;
    for (var oi = 0; oi < orbitR.length; oi++) {
      var oa = orbitR[oi] * sc;
      var ob = oa * 0.58;
      ctx.beginPath();
      ctx.ellipse(cx, cy, oa, ob, orbitTilt, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. 桌面轨道上的单颗【穿梭数据微光子】（象征光纤同频流动）
    var photonAngle = (t * 0.00035) % (Math.PI * 2);
    var phA = 178 * sc, phB = 104 * sc * 0.58;
    var phX0 = phA * Math.cos(photonAngle);
    var phY0 = phB * Math.sin(photonAngle);
    var phRx = phX0 * Math.cos(orbitTilt) - phY0 * Math.sin(orbitTilt);
    var phRy = phX0 * Math.sin(orbitTilt) + phY0 * Math.cos(orbitTilt);

    ctx.fillStyle = isDark ? '#34D399' : '#10B981';
    ctx.beginPath();
    ctx.arc(cx + phRx, cy + phRy, 2 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. 更新 6 颗天体的空间坐标、超短流线与微交互悬停感应
    var backPlanets = [];
    var frontPlanets = [];

    var mouseCanvasX = (pointer.px !== undefined ? pointer.px : -9999) - (wrapper ? wrapper.clientWidth / 2 : cx);
    var mouseCanvasY = (pointer.py !== undefined ? pointer.py : -9999) - (wrapper ? wrapper.clientHeight / 2 : cy);

    for (var pi = 0; pi < planets.length; pi++) {
      var p = planets[pi];
      p.theta += p.speed * dt;

      var a = p.orbitA * sc;
      var b = p.orbitB * sc;

      var x0 = a * Math.cos(p.theta);
      var y0 = b * Math.sin(p.theta);

      var rx = x0 * Math.cos(orbitTilt) - y0 * Math.sin(orbitTilt);
      var ry = x0 * Math.sin(orbitTilt) + y0 * Math.cos(orbitTilt);

      p.x = cx + rx;
      p.y = cy + ry;

      var z = Math.sin(p.theta);
      p.z = z;
      p.scale = 0.88 + (z + 1) * 0.14;
      p.alpha = 0.65 + (z + 1) * 0.18;

      // 羽量级超短微流线（仅保留 3 步历史点，营造动感但绝无涂抹烟尘）
      p.trail.unshift({ x: p.x, y: p.y });
      if (p.trail.length > 4) p.trail.pop();

      // 鼠标邻近微悬停感应
      var distToMouse = Math.hypot((p.x - cx) - mouseCanvasX, (p.y - cy) - mouseCanvasY);
      var targetHover = (pointer.active && distToMouse < 55 * sc) ? 1 : 0;
      p.hover += (targetHover - p.hover) * 0.15;

      if (z < 0) {
        backPlanets.push(p);
      } else {
        frontPlanets.push(p);
      }
    }

    var breath = 1 + Math.sin(t * 0.0018) * 0.025;
    var coreR = (30 + corePulse * 7) * sc * breath;

    // 4. 绘制后景天体羁绊连接线、微流线与后景天体
    for (var bi = 0; bi < backPlanets.length; bi++) {
      var bp = backPlanets[bi];
      renderTether(bp, cx, cy, coreR, sc, isDark);
      if (bp.trail.length > 1) {
        ctx.save();
        ctx.strokeStyle = bp.color;
        ctx.lineCap = 'round';
        for (var t1 = 0; t1 < bp.trail.length - 1; t1++) {
          var ptA1 = bp.trail[t1];
          var ptB1 = bp.trail[t1 + 1];
          var prog1 = 1 - t1 / bp.trail.length;
          ctx.lineWidth = Math.max(0.5, (1.4 - t1 * 0.3) * sc);
          ctx.globalAlpha = prog1 * bp.alpha * 0.20;
          ctx.beginPath();
          ctx.moveTo(ptA1.x, ptA1.y);
          ctx.lineTo(ptB1.x, ptB1.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      renderPlanet(bp, cx, cy, sc, t, isDark);
    }

    // 5. 绘制正中央【经典分享徽章核心】
    renderCentralShareCore(cx, cy, coreR, sc, t, isDark);

    // 6. 绘制前景天体羁绊连接线、微流线与前景天体
    for (var fi = 0; fi < frontPlanets.length; fi++) {
      var fp = frontPlanets[fi];
      renderTether(fp, cx, cy, coreR, sc, isDark);
      if (fp.trail.length > 1) {
        ctx.save();
        ctx.strokeStyle = fp.color;
        ctx.lineCap = 'round';
        for (var t2 = 0; t2 < fp.trail.length - 1; t2++) {
          var ptA2 = fp.trail[t2];
          var ptB2 = fp.trail[t2 + 1];
          var prog2 = 1 - t2 / fp.trail.length;
          ctx.lineWidth = Math.max(0.5, (1.4 - t2 * 0.3) * sc);
          ctx.globalAlpha = prog2 * fp.alpha * 0.20;
          ctx.beginPath();
          ctx.moveTo(ptA2.x, ptA2.y);
          ctx.lineTo(ptB2.x, ptB2.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      renderPlanet(fp, cx, cy, sc, t, isDark);
    }

    // 7. 交互点击激发的【全星系引力冲击双波】（突破画幅自由扩散消融）
    for (var si = shockwaves.length - 1; si >= 0; si--) {
      var sw = shockwaves[si];
      sw.r += sw.speed * dt;
      var progress = Math.min(1, sw.r / sw.maxR);
      var fade = Math.pow(Math.max(0, 1 - progress), 1.8);
      sw.alpha = fade;

      if (fade > 0.005) {
        ctx.save();
        var swAlpha = (isDark ? 0.72 : 0.65) * fade * (sw.weight || 1);
        ctx.strokeStyle = isDark ? 'rgba(52, 211, 153, ' + swAlpha + ')' : 'rgba(16, 185, 129, ' + swAlpha + ')';
        ctx.lineWidth = Math.max(0.6, 2.2 * sc * fade * (sw.weight || 1));
        ctx.beginPath();
        ctx.ellipse(cx, cy, sw.r, sw.r * 0.58, orbitTilt, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (progress >= 1 || fade <= 0.005) {
        shockwaves.splice(si, 1);
      }
    }
  }

  function loop(now) {
    if (!running) return;
    var dt = (now - lastT) * 0.001;
    if (dt > 0.1) dt = 0.016;
    lastT = now;
    renderFrame(now, dt);
    rafId = requestAnimationFrame(loop);
  }

  function play() {
    if (running || reducedMotion) return;
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function onPointerMove(e) {
    if (!wrapper) return;
    var rect = wrapper.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    pointer.tx = (px - rect.width / 2) / (rect.width / 2);
    pointer.ty = (py - rect.height / 2) / (rect.height / 2);
    pointer.px = px;
    pointer.py = py;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.tx = 0;
    pointer.ty = 0;
    pointer.px = -9999;
    pointer.py = -9999;
    pointer.active = false;
  }

  function triggerShockwave() {
    corePulse = 1.0;
    // 突破画幅限制：利用超界拓展的画幅空间（200%宽度），保留完整原版宏大脉冲发散半径
    // 脉冲波将自由突破容器画幅边界，穿透至外部空间并自然消融，不再受画幅拘束
    var maxPulseR = Math.max(wrapper.clientWidth, wrapper.clientHeight) * 0.96;
    shockwaves.push({
      r: 16 * sc,
      maxR: maxPulseR,
      speed: 480 * sc,
      weight: 1.0
    });
    // 伴生微回声副波（双重微涟漪，营造水滴空灵质感）
    shockwaves.push({
      r: 8 * sc,
      maxR: maxPulseR * 0.88,
      speed: 430 * sc,
      weight: 0.55
    });
  }

  function start() {
    resize();
    if (reducedMotion) {
      renderFrame(0, 0);
      return;
    }

    var host = canvas.closest('.sect') || wrapper;
    if (host) {
      host.addEventListener('pointermove', onPointerMove, { passive: true });
      host.addEventListener('pointerleave', onPointerLeave, { passive: true });
      host.addEventListener('click', triggerShockwave);
    }
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
    canvas.addEventListener('click', triggerShockwave);

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

    window.addEventListener('resize', resize, { passive: true });
    play();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
