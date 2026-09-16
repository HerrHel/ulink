/*
 * 与链 ulink — 创作与分享视觉「4套全新顶级概念集成引擎」
 * （/ 首页专用，Canvas 2D，零依赖，纯原生动效）
 *
 * 支持通过 URL 参数 (?concept=1|2|3|4) 或 localStorage('lv_share_concept') 动态切换：
 * - Concept 1: 【白水晶棱镜与色散分光】(Prismatic Refraction & Dispersion) —— 纯粹光学，晶莹通透
 * - Concept 2: 【量子链接胶囊与光纤流转】(Quantum URL Capsule & Conduit Ingestion) —— 极速管道，链接入库
 * - Concept 3: 【磁悬浮卡片与细胞级抽离】(Magnetic Deck Mitosis & Tactile Slide) —— 真实 2.5D 弹簧阻尼卡牌
 * - Concept 4: 【多端协同光标与隔空投送】(Multiplayer Cursors & Gravitational AirDrop) —— 社交协同，以链会友
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

  // 获取当前选定概念 (优先 URL ?concept=，其次 localStorage，默认 1)
  var activeConcept = (function () {
    try {
      var urlP = new URLSearchParams(window.location.search).get('concept');
      if (urlP && /^[1-4]$/.test(urlP)) return parseInt(urlP, 10);
      var saved = localStorage.getItem('lv_share_concept');
      if (saved && /^[1-4]$/.test(saved)) return parseInt(saved, 10);
    } catch (e) {}
    return 1; // 默认白水晶棱镜
  })();

  var W = 0, H = 0, DPR = 1;
  var pointer = { x: -1000, y: -1000, tx: 0, ty: 0, active: false };
  var lastT = 0, rafId = 0, running = false, inView = true;
  var clock = 0;

  function isDarkTheme() {
    var dt = document.documentElement.getAttribute('data-theme');
    if (dt) return dt === 'dark';
    var looks = document.getElementById('looks');
    if (looks && looks.getAttribute('data-mode') === 'dark') return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function drawRoundRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) {
      c.roundRect(x, y, w, h, r);
    } else {
      c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      c.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 2);
      c.arc(x + w - r, y + h - r, r, 0, Math.PI * 0.5);
      c.arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI);
      c.closePath();
    }
  }

  /* ═══════════════════════════════════════════════════════════
     概念 1 状态与逻辑：白水晶棱镜与色散分光
     ═══════════════════════════════════════════════════════════ */
  var prismPulse = 0;
  var prismPhotons = [];
  for (var p1 = 0; p1 < 18; p1++) {
    prismPhotons.push({
      stage: p1 < 6 ? 0 : (p1 % 3) + 1,
      t: Math.random(),
      speed: 0.006 + Math.random() * 0.008,
      size: 2.2 + Math.random() * 1.5
    });
  }

  function renderPrism(time, dark, isEn) {
    if (prismPulse > 0.01) prismPulse *= 0.94; else prismPulse = 0;

    var cx = W * 0.44;
    var cy = H * 0.48;
    var size = Math.min(W, H) * 0.23;

    var rotOffset = pointer.active ? pointer.tx * 0.18 : 0;
    var pitchOffset = pointer.active ? pointer.ty * 0.14 : 0;

    var pTop = { x: cx + Math.sin(rotOffset) * size, y: cy - size + pitchOffset * 15 };
    var pRight = { x: cx + Math.cos(Math.PI / 6 + rotOffset) * size, y: cy + Math.sin(Math.PI / 6) * size };
    var pLeft = { x: cx - Math.cos(Math.PI / 6 - rotOffset) * size, y: cy + Math.sin(Math.PI / 6) * size };

    // 1. 柔和环境光
    var bgGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, size * 2.2);
    bgGrad.addColorStop(0, dark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(18, 46, 138, 0.08)');
    bgGrad.addColorStop(0.6, dark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.05)');
    bgGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // 2. 左侧入射光束
    var inStartX = W * 0.12;
    var inStartY = cy + Math.sin(time * 1.5) * 8;
    var inHitX = (pTop.x + pLeft.x) * 0.5;
    var inHitY = (pTop.y + pLeft.y) * 0.5;

    var inGrad = ctx.createLinearGradient(inStartX, inStartY, inHitX, inHitY);
    inGrad.addColorStop(0, dark ? 'rgba(240, 74, 138, 0.85)' : 'rgba(18, 46, 138, 0.85)');
    inGrad.addColorStop(1, dark ? 'rgba(96, 165, 250, 0.95)' : 'rgba(59, 130, 246, 0.95)');

    ctx.beginPath();
    ctx.moveTo(inStartX, inStartY);
    ctx.lineTo(inHitX, inHitY);
    ctx.strokeStyle = inGrad;
    ctx.lineWidth = 3.2 + prismPulse * 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(inStartX, inStartY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#F04A8A' : '#122E8A';
    ctx.fill();

    // 3. 右侧色散光谱
    var outFaceX = (pTop.x + pRight.x) * 0.5;
    var outFaceY = (pTop.y + pRight.y) * 0.5;

    var rays = [
      { destX: W * 0.86, destY: H * 0.28, color: '#38BDF8', label: isEn ? 'FORK // DOCS' : 'FORK // 架构文档' },
      { destX: W * 0.88, destY: H * 0.48, color: '#10B981', label: isEn ? 'FORK // REPLICA · LOCAL' : 'FORK // 本地知识副本', isMain: true },
      { destX: W * 0.84, destY: H * 0.68, color: '#34D399', label: isEn ? 'FORK // EXTENSION' : 'FORK // 插件直连' }
    ];

    for (var r = 0; r < rays.length; r++) {
      var ray = rays[r];
      var rStartY = outFaceY + (r - 1) * 16;
      var rStartX = outFaceX + (r - 1) * 4;

      ctx.beginPath();
      ctx.moveTo(inHitX, inHitY);
      ctx.lineTo(rStartX, rStartY);
      ctx.strokeStyle = ray.color;
      ctx.lineWidth = 1.4 + prismPulse * 1.5;
      ctx.stroke();

      var rayGrad = ctx.createLinearGradient(rStartX, rStartY, ray.destX, ray.destY);
      rayGrad.addColorStop(0, ray.color);
      rayGrad.addColorStop(1, 'rgba(255, 255, 255, 0.4)');

      ctx.beginPath();
      ctx.moveTo(rStartX, rStartY);
      ctx.lineTo(ray.destX, ray.destY);
      ctx.strokeStyle = rayGrad;
      ctx.lineWidth = (ray.isMain ? 2.8 : 1.8) + prismPulse * 2.5;
      ctx.stroke();

      var glowR = (ray.isMain ? 9 : 6) + prismPulse * 8;
      ctx.beginPath();
      ctx.arc(ray.destX, ray.destY, glowR, 0, Math.PI * 2);
      ctx.fillStyle = ray.color;
      ctx.shadowColor = ray.color;
      ctx.shadowBlur = 16 + prismPulse * 25;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(ray.destX, ray.destY, ray.isMain ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.font = '600 8.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? ray.color : (ray.isMain ? '#059669' : '#475569');
      ctx.fillText(ray.label, ray.destX + 14, ray.destY);
    }

    // 光子流
    for (var i = 0; i < prismPhotons.length; i++) {
      var pt = prismPhotons[i];
      pt.t += pt.speed + prismPulse * 0.02;
      if (pt.t > 1) pt.t = 0;

      var px, py, pColor;
      if (pt.stage === 0) {
        px = inStartX + (inHitX - inStartX) * pt.t;
        py = inStartY + (inHitY - inStartY) * pt.t;
        pColor = dark ? '#F04A8A' : '#3B82F6';
      } else {
        var targetRay = rays[pt.stage - 1];
        var sY = outFaceY + (pt.stage - 2) * 16;
        var sX = outFaceX + (pt.stage - 2) * 4;
        px = sX + (targetRay.destX - sX) * pt.t;
        py = sY + (targetRay.destY - sY) * pt.t;
        pColor = targetRay.color;
      }

      ctx.beginPath();
      ctx.arc(px, py, pt.size * (1 + prismPulse * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = pColor;
      ctx.shadowColor = pColor;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 棱镜主体
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.lineTo(pLeft.x, pLeft.y);
    ctx.closePath();

    var prismGrad = ctx.createLinearGradient(pTop.x, pTop.y, (pRight.x + pLeft.x)*0.5, (pRight.y + pLeft.y)*0.5);
    prismGrad.addColorStop(0, dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.75)');
    prismGrad.addColorStop(0.5, dark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(245, 239, 234, 0.85)');
    prismGrad.addColorStop(1, dark ? 'rgba(16, 185, 129, 0.24)' : 'rgba(230, 248, 242, 0.90)');
    ctx.fillStyle = prismGrad;
    ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(44, 40, 36, 0.12)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.strokeStyle = dark ? 'rgba(52, 211, 153, 0.4)' : 'rgba(18, 46, 138, 0.25)';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    ctx.font = '700 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.75)' : 'rgba(18, 46, 138, 0.65)';
    ctx.fillText('λ // REFRACT', cx + rotOffset * 20, cy + 8);
    ctx.restore();

    // 底部提示
    renderHintText(
      isEn
        ? '✦ PRISM DISPERSION: CLICK ANYWHERE TO TRIGGER REFRACTIVE SURGE'
        : '✦ 棱镜色散分光 · 点击舞台任意处激发全反射色散脉冲',
      dark
    );
  }

  /* ═══════════════════════════════════════════════════════════
     概念 2 状态与逻辑：【量子链接胶囊与光纤流转】(Quantum URL Capsule & Conduit Ingestion)
     ═══════════════════════════════════════════════════════════ */
  var capsuleState = {
    animProgress: 0,
    targetProgress: 0,
    burstT: -1,
    burstFlash: 0
  };

  var conduitPhotons = [];
  for (var cp = 0; cp < 14; cp++) {
    conduitPhotons.push({
      t: Math.random(),
      speed: 0.005 + Math.random() * 0.007,
      size: 1.8 + Math.random() * 1.4,
      hue: Math.random() > 0.4 ? 'green' : 'blue'
    });
  }

  function getConduitPoint(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var mt2 = mt * mt;
    var mt3 = mt2 * mt;
    var t2 = t * t;
    var t3 = t2 * t;
    return {
      x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
      y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
    };
  }

  function renderCapsuleConduit(time, dark, isEn) {
    capsuleState.animProgress += (capsuleState.targetProgress - capsuleState.animProgress) * 0.08;
    if (capsuleState.burstFlash > 0.02) capsuleState.burstFlash *= 0.92; else capsuleState.burstFlash = 0;

    if (capsuleState.burstT >= 0) {
      capsuleState.burstT += 0.038;
      if (capsuleState.burstT >= 1) {
        capsuleState.burstT = -1;
        capsuleState.targetProgress = 1.0;
      }
    }

    var cy = H * 0.48;
    var pitchOff = pointer.active ? pointer.ty * 18 : 0;
    var yawOff = pointer.active ? pointer.tx * 14 : 0;

    var capW = Math.min(204, Math.max(176, W * 0.32));
    var capH = 36;
    var capX = Math.max(capW * 0.5 + 14, W * 0.22) + yawOff * 0.5;
    var capY = cy + Math.sin(time * 1.6) * 4;

    var dockW = Math.min(216, Math.max(176, W * 0.32));
    var dockH = 92 + capsuleState.animProgress * 44;
    var dockX = Math.min(W - dockW * 0.5 - 14, W * 0.78) - yawOff * 0.5;
    var dockY = cy + Math.sin(time * 1.6 + 1.2) * 4;

    var p0 = { x: capX + capW * 0.5, y: capY };
    var p3 = { x: dockX - dockW * 0.5, y: dockY };
    var midX = (p0.x + p3.x) * 0.5;
    var p1 = { x: midX - 30, y: cy - 45 + pitchOff };
    var p2 = { x: midX + 30, y: cy + 45 + pitchOff };

    // --- 绘制光纤管线 ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.strokeStyle = dark ? 'rgba(59, 130, 246, 0.16)' : 'rgba(18, 46, 138, 0.08)';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(18, 46, 138, 0.22)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.strokeStyle = dark ? 'rgba(52, 211, 153, 0.65)' : 'rgba(16, 185, 129, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // 常规光子流动
    for (var i = 0; i < conduitPhotons.length; i++) {
      var ph = conduitPhotons[i];
      ph.t += ph.speed;
      if (ph.t > 1) ph.t = 0;

      var pt = getConduitPoint(p0, p1, p2, p3, ph.t);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ph.size, 0, Math.PI * 2);
      ctx.fillStyle = ph.hue === 'green'
        ? (dark ? '#34D399' : '#10B981')
        : (dark ? '#60A5FA' : '#3B82F6');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 脉冲激光弹道
    if (capsuleState.burstT >= 0) {
      var bPt = getConduitPoint(p0, p1, p2, p3, capsuleState.burstT);
      for (var trail = 1; trail <= 4; trail++) {
        var trT = Math.max(0, capsuleState.burstT - trail * 0.025);
        var trPt = getConduitPoint(p0, p1, p2, p3, trT);
        ctx.beginPath();
        ctx.arc(trPt.x, trPt.y, 4 - trail * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 211, 153, ' + (0.8 - trail * 0.18) + ')';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(bPt.x, bPt.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#10B981';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // --- 左侧 URL 胶囊 ---
    ctx.save();
    ctx.translate(capX, capY);
    var capBg = dark ? '#25252B' : '#FDFBF9';
    ctx.beginPath();
    drawRoundRect(ctx, -capW * 0.5, -capH * 0.5, capW, capH, capH * 0.5);
    ctx.fillStyle = capBg;
    ctx.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(44,40,36,0.10)';
    ctx.shadowBlur = 16 + capsuleState.burstFlash * 15;
    ctx.shadowOffsetY = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = capsuleState.burstFlash > 0.1
      ? '#10B981'
      : (dark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(18, 46, 138, 0.25)');
    ctx.lineWidth = 1.4 + capsuleState.burstFlash * 1.5;
    ctx.stroke();

    var dotPulse = Math.sin(time * 4) * 0.35 + 0.65;
    ctx.beginPath();
    ctx.arc(-capW * 0.5 + 15, 0, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = '#10B981';
    ctx.shadowColor = '#10B981';
    ctx.shadowBlur = 8 * dotPulse;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? '#EEE9E2' : '#2C2824';
    ctx.fillText('ulink.ren/s/8f2a', -capW * 0.5 + 23, 0);

    ctx.font = '700 7.5px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = capsuleState.burstFlash > 0.1 ? '#10B981' : (dark ? '#9B968E' : '#6A6660');
    ctx.fillText(capsuleState.burstFlash > 0.1 ? '⚡ COPIED' : 'SHARE ↗', capW * 0.5 - 10, 0);
    ctx.restore();

    // --- 右侧 Local Vault 接收槽 ---
    ctx.save();
    ctx.translate(dockX, dockY);

    var prog = capsuleState.animProgress;
    var dockBg = dark ? '#202026' : '#FDFBF9';
    var borderCol = prog > 0.5
      ? (dark ? '#34D399' : '#10B981')
      : (dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(18, 46, 138, 0.2)');

    ctx.beginPath();
    drawRoundRect(ctx, -dockW * 0.5, -dockH * 0.5, dockW, dockH, 14);
    ctx.fillStyle = dockBg;
    ctx.shadowColor = dark ? 'rgba(0,0,0,0.55)' : 'rgba(44,40,36,0.10)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = borderCol;
    ctx.lineWidth = prog > 0.5 ? 1.6 : 1.2;
    if (prog < 0.2) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (prog < 0.3) {
      ctx.font = '700 8.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? '#9B968E' : '#6A6660';
      ctx.fillText(isEn ? 'LOCAL VAULT // READY' : '本地保险库 // 等待载入', 0, -12);

      ctx.font = '500 8px ui-monospace, monospace';
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)';
      ctx.fillText(isEn ? 'CLICK TO INJECT & FORK' : '点击胶囊发射光子流', 0, 10);

      ctx.beginPath();
      ctx.arc(0, 24, 6, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(52, 211, 153, 0.4)' : 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.globalAlpha = Math.min(1, (prog - 0.2) * 1.35);

      ctx.beginPath();
      drawRoundRect(ctx, -dockW * 0.5 + 14, -dockH * 0.5 + 14, 26, 4.5, 2.2);
      ctx.fillStyle = dark ? '#34D399' : '#10B981';
      ctx.fill();

      ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dark ? '#EEE9E2' : '#2C2824';
      ctx.fillText(isEn ? 'Tech Radar & Dev Stack' : '前端架构与前沿设计库', -dockW * 0.5 + 14, -dockH * 0.5 + 24);

      for (var row = 0; row < 3; row++) {
        var ry = -dockH * 0.5 + 44 + row * 16;
        var rLen = row === 1 ? dockW * 0.55 : dockW * 0.72;
        ctx.beginPath();
        ctx.arc(-dockW * 0.5 + 18, ry + 4, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = row === 0 ? '#3B82F6' : (row === 1 ? '#10B981' : '#F59E0B');
        ctx.fill();

        drawRoundRect(ctx, -dockW * 0.5 + 26, ry + 2, rLen, 4, 2);
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(106, 102, 96, 0.3)';
        ctx.fill();
      }

      var by = dockH * 0.5 - 18;
      ctx.font = '700 8.5px ui-monospace, "SF Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? '#34D399' : '#059669';
      ctx.fillText('✓ FORKED // LOCAL SYNCED', -dockW * 0.5 + 14, by);

      ctx.font = '600 8px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = dark ? '#9B968E' : '#6A6660';
      ctx.fillText('12 LINKS', dockW * 0.5 - 14, by);
      ctx.globalAlpha = 1.0;
    }
    ctx.restore();

    var hint = isEn
      ? (capsuleState.targetProgress > 0.5 ? '✦ QUANTUM CONDUIT: PAYLOAD INGESTED (CLICK TO RESET)' : '✦ QUANTUM CONDUIT: CLICK CAPSULE TO STREAM PAYLOAD')
      : (capsuleState.targetProgress > 0.5 ? '✦ 光纤流转成功 · 已将公开组瞬态载入本地库（点击重置）' : '✦ 量子链接胶囊 · 点击发射高能光子流经光纤管道入库');
    renderHintText(hint, dark);
  }

  /* ═══════════════════════════════════════════════════════════
     概念 3 状态与逻辑：磁悬浮卡片与细胞级抽离
     ═══════════════════════════════════════════════════════════ */
  var cardSlide = 0;
  var cardTargetSlide = 0;

  function renderCardSlide(time, dark, isEn) {
    cardSlide += (cardTargetSlide - cardSlide) * 0.08;

    var cx = W * 0.5;
    var cy = H * 0.48;
    var cW = Math.min(180, Math.max(140, W * 0.32));
    var cH = cW * 1.32;

    var pRotX = pointer.active ? pointer.tx * 0.08 : 0;

    var c1x = cx - cardSlide * 75 - (cardSlide === 0 ? 0 : 20);
    var c1y = cy;
    var c2x = cx + cardSlide * 110 + (cardSlide === 0 ? 8 : 20);
    var c2y = cy - cardSlide * 8;

    if (cardSlide > 0.15) {
      ctx.save();
      for (var l = 0; l < 3; l++) {
        var ly = cy + (l - 1) * 26;
        ctx.beginPath();
        ctx.moveTo(c1x + cW * 0.5, ly);
        ctx.lineTo(c2x - cW * 0.5, ly);
        ctx.strokeStyle = l === 1 ? '#10B981' : (dark ? 'rgba(255,255,255,0.15)' : 'rgba(18,46,138,0.15)');
        ctx.lineWidth = l === 1 ? 1.6 : 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        var tPr = (time * 0.8 + l * 0.33) % 1;
        var px = (c1x + cW * 0.5) + (c2x - cW * 0.5 - (c1x + cW * 0.5)) * tPr;
        ctx.beginPath();
        ctx.arc(px, ly, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#10B981';
        ctx.fill();
      }
      ctx.restore();
    }

    function drawSingleCard(x, y, rot, isReplica) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot + pRotX);

      var bg = dark ? '#25252B' : '#FDFBF9';
      var borderCol = isReplica
        ? (dark ? '#34D399' : '#10B981')
        : (dark ? 'rgba(240, 74, 138, 0.4)' : 'rgba(18, 46, 138, 0.25)');

      ctx.beginPath();
      drawRoundRect(ctx, -cW * 0.5, -cH * 0.5, cW, cH, 14);
      ctx.fillStyle = bg;
      ctx.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(44, 40, 36, 0.10)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 8;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = isReplica ? 1.6 : 1.25;
      ctx.stroke();

      ctx.beginPath();
      drawRoundRect(ctx, -cW * 0.5 + 14, -cH * 0.5 + 14, 28, 5, 2.5);
      ctx.fillStyle = isReplica ? (dark ? '#34D399' : '#10B981') : (dark ? '#F04A8A' : '#122E8A');
      ctx.fill();

      ctx.fillStyle = dark ? '#EEE9E2' : '#2C2824';
      drawRoundRect(ctx, -cW * 0.5 + 14, -cH * 0.5 + 26, cW * 0.65, 8, 4);
      ctx.fill();

      for (var r = 0; r < 4; r++) {
        var rw = (r === 1) ? cW * 0.55 : cW * 0.72;
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(106, 102, 96, 0.35)';
        drawRoundRect(ctx, -cW * 0.5 + 14, -cH * 0.5 + 46 + r * 12, rw, 3.5, 1.7);
        ctx.fill();
      }

      var ncy = -cH * 0.5 + 104;
      var nch = cH - 104 - 32;
      drawRoundRect(ctx, -cW * 0.5 + 12, ncy, cW - 24, nch, 8);
      ctx.fillStyle = dark ? 'rgba(32, 32, 38, 0.9)' : 'rgba(245, 239, 234, 0.8)';
      ctx.fill();
      ctx.strokeStyle = isReplica ? 'rgba(16, 185, 129, 0.35)' : (dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)');
      ctx.lineWidth = 1;
      ctx.stroke();

      var bottomText = isReplica ? '✦ FORKED // LOCAL' : 'ORIGIN // 8F2A';
      ctx.font = '700 8.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isReplica ? (dark ? '#34D399' : '#059669') : (dark ? '#F04A8A' : '#122E8A');
      ctx.fillText(bottomText, -cW * 0.5 + 14, cH * 0.5 - 14);

      ctx.restore();
    }

    drawSingleCard(c2x, c2y, 0.04 - cardSlide * 0.02, true);
    drawSingleCard(c1x, c1y, -0.02, false);

    var slideText = isEn
      ? (cardSlide > 0.6 ? '✦ CARD FORKED: TACTILE MITOSIS (CLICK TO STACK BACK)' : '✦ STACKED STATE: CLICK CARD TO TRIGGER TACTILE FORK SLIDE')
      : (cardSlide > 0.6 ? '✦ 卡牌已抽离克隆 · 独立本地副本（点击收回层叠）' : '✦ 磁悬浮卡牌 · 点击触发弹簧阻尼抽离 Fork');
    renderHintText(slideText, dark);
  }

  /* ═══════════════════════════════════════════════════════════
     概念 4 状态与逻辑：【多端协同光标与隔空投送】(Multiplayer Cursors & Gravitational AirDrop)
     ═══════════════════════════════════════════════════════════ */
  var multiplayerState = {
    airdropActive: false,
    airdropRadius: 0,
    airdropAlpha: 0,
    cloneX: 0,
    cloneY: 0,
    cloneTargetX: 0,
    cloneTargetY: 0,
    cloneScale: 0
  };

  function drawCursorArrow(c, x, y, color, tag, dark) {
    c.save();
    c.translate(x, y);

    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 15);
    c.lineTo(4, 11);
    c.lineTo(9, 15);
    c.lineTo(11, 13);
    c.lineTo(6, 9);
    c.lineTo(12, 9);
    c.closePath();

    c.fillStyle = color;
    c.shadowColor = dark ? 'rgba(0,0,0,0.6)' : 'rgba(44,40,36,0.18)';
    c.shadowBlur = 6;
    c.shadowOffsetY = 2;
    c.fill();
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;

    c.strokeStyle = '#FFFFFF';
    c.lineWidth = 1.2;
    c.stroke();

    if (tag) {
      c.font = '600 8.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      var tw = c.measureText(tag).width;
      var bx = 12, by = 12;
      var bw = tw + 12, bh = 18;

      c.beginPath();
      drawRoundRect(c, bx, by, bw, bh, 6);
      c.fillStyle = color;
      c.shadowColor = color;
      c.shadowBlur = 8;
      c.fill();
      c.shadowBlur = 0;

      c.fillStyle = '#FFFFFF';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(tag, bx + 6, by + bh * 0.5);
    }
    c.restore();
  }

  function renderMultiplayerAirDrop(time, dark, isEn) {
    var cx = W * 0.50;
    var cy = H * 0.44;
    var cardW = Math.min(220, W * 0.35);
    var cardH = 136;

    var peer1X = cx - cardW * 0.35 + Math.sin(time * 0.9) * 65 + Math.cos(time * 1.5) * 18;
    var peer1Y = cy - 22 + Math.cos(time * 0.8) * 40;

    var peer2X = cx + cardW * 0.38 + Math.cos(time * 0.7) * 55;
    var peer2Y = cy + 24 + Math.sin(time * 1.1) * 36;

    var userX = pointer.active ? pointer.x : (cx - 70 + Math.sin(time * 0.6) * 15);
    var userY = pointer.active ? pointer.y : (cy + 75 + Math.cos(time * 0.6) * 12);

    // 中心公共卡牌
    ctx.save();
    ctx.translate(cx, cy);

    var cardBg = dark ? '#25252B' : '#FDFBF9';
    ctx.beginPath();
    drawRoundRect(ctx, -cardW * 0.5, -cardH * 0.5, cardW, cardH, 14);
    ctx.fillStyle = cardBg;
    ctx.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(44,40,36,0.12)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(18, 46, 138, 0.25)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.beginPath();
    drawRoundRect(ctx, -cardW * 0.5 + 14, -cardH * 0.5 + 14, 30, 5, 2.5);
    ctx.fillStyle = dark ? '#F04A8A' : '#122E8A';
    ctx.fill();

    ctx.fillStyle = dark ? '#EEE9E2' : '#2C2824';
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(isEn ? 'Awesome AI & Design Stack' : 'AI 工具链与视觉灵感库', -cardW * 0.5 + 14, -cardH * 0.5 + 26);

    for (var i = 0; i < 3; i++) {
      var iy = -cardH * 0.5 + 48 + i * 16;
      ctx.beginPath();
      ctx.arc(-cardW * 0.5 + 18, iy + 4, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#38BDF8' : (i === 1 ? '#10B981' : '#F43F5E');
      ctx.fill();

      drawRoundRect(ctx, -cardW * 0.5 + 26, iy + 2, (i === 1 ? cardW * 0.5 : cardW * 0.68), 4, 2);
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(106, 102, 96, 0.3)';
      ctx.fill();
    }

    var by = cardH * 0.5 - 16;
    ctx.font = '700 8.5px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? '#9B968E' : '#6A6660';
    ctx.fillText('PUBLIC // 820 FORKS', -cardW * 0.5 + 14, by);

    ctx.beginPath();
    ctx.arc(cardW * 0.5 - 18, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#38BDF8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cardW * 0.5 - 28, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#FB7185';
    ctx.fill();
    ctx.restore();

    // 磁力丝线
    var distToCenter = Math.hypot(userX - cx, userY - cy);
    if (distToCenter < 240) {
      var tetherAlpha = Math.max(0, 1 - distToCenter / 240);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(userX, userY);
      ctx.strokeStyle = dark
        ? 'rgba(52, 211, 153, ' + tetherAlpha * 0.4 + ')'
        : 'rgba(16, 185, 129, ' + tetherAlpha * 0.35 + ')';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // AirDrop 共振波与投送克隆
    if (multiplayerState.airdropActive) {
      multiplayerState.airdropRadius += 4.5;
      multiplayerState.airdropAlpha -= 0.022;

      ctx.beginPath();
      ctx.arc(userX, userY, multiplayerState.airdropRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(16, 185, 129, ' + Math.max(0, multiplayerState.airdropAlpha) + ')';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      multiplayerState.cloneX += (multiplayerState.cloneTargetX - multiplayerState.cloneX) * 0.12;
      multiplayerState.cloneY += (multiplayerState.cloneTargetY - multiplayerState.cloneY) * 0.12;
      multiplayerState.cloneScale = Math.min(1.0, multiplayerState.cloneScale + 0.08);

      ctx.save();
      ctx.translate(multiplayerState.cloneX, multiplayerState.cloneY);
      ctx.scale(multiplayerState.cloneScale, multiplayerState.cloneScale);

      var clW = cardW * 0.78;
      var clH = cardH * 0.78;
      ctx.beginPath();
      drawRoundRect(ctx, -clW * 0.5, -clH * 0.5, clW, clH, 10);
      ctx.fillStyle = dark ? '#222228' : '#FFFFFF';
      ctx.shadowColor = '#10B981';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '700 8.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? '#34D399' : '#059669';
      ctx.fillText('✓ AIRDROP: FORKED TO VAULT', 0, 0);
      ctx.restore();

      if (multiplayerState.airdropAlpha <= 0 && multiplayerState.airdropRadius > 260) {
        multiplayerState.airdropActive = false;
      }
    }

    // 绘制协同光标
    drawCursorArrow(ctx, peer1X, peer1Y, '#38BDF8', 'Alex (Tokyo)', dark);
    drawCursorArrow(ctx, peer2X, peer2Y, '#FB7185', 'Elena (Berlin)', dark);
    drawCursorArrow(ctx, userX, userY, '#10B981', 'You (Local)', dark);

    var hint = isEn
      ? (multiplayerState.airdropActive ? '✦ AIRDROP PULSE: DUPLICATING TO VAULT' : '✦ MULTIPLAYER AIRDROP: CLICK ANYWHERE TO AIRDROP FORK')
      : (multiplayerState.airdropActive ? '✦ 隔空投送中 · 克隆副本已吸附入库' : '✦ 多端协同光标 · 点击舞台触发 AirDrop 隔空投送 Fork');
    renderHintText(hint, dark);
  }

  // 底部统一轻量交互提示
  function renderHintText(text, dark) {
    ctx.save();
    ctx.font = '500 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dark ? 'rgba(155, 150, 142, 0.75)' : 'rgba(106, 102, 96, 0.78)';
    ctx.fillText(text, W * 0.5, H * 0.94);
    ctx.restore();
  }

  function resize() {
    if (!wrapper) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = wrapper.clientWidth;
    H = wrapper.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.tx = (pointer.x - W * 0.5) / Math.max(1, W * 0.5);
    pointer.ty = (pointer.y - H * 0.5) / Math.max(1, H * 0.5);
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.tx = 0;
    pointer.ty = 0;
  }

  function onClick() {
    if (activeConcept === 1) {
      prismPulse = 1.0;
    } else if (activeConcept === 2) {
      capsuleState.burstT = 0;
      capsuleState.burstFlash = 1.0;
      if (capsuleState.targetProgress > 0.5) {
        capsuleState.targetProgress = 0;
      }
    } else if (activeConcept === 3) {
      cardTargetSlide = cardTargetSlide === 0 ? 1.0 : 0;
    } else if (activeConcept === 4) {
      multiplayerState.airdropActive = true;
      multiplayerState.airdropRadius = 8;
      multiplayerState.airdropAlpha = 0.95;
      multiplayerState.cloneX = W * 0.50;
      multiplayerState.cloneY = H * 0.44;
      var destX = pointer.active ? pointer.x : W * 0.35;
      var destY = pointer.active ? pointer.y + 30 : H * 0.68;
      multiplayerState.cloneTargetX = destX;
      multiplayerState.cloneTargetY = destY;
      multiplayerState.cloneScale = 0.35;
    }
  }

  function draw(now) {
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016;
    lastT = now;
    clock += dt;

    ctx.clearRect(0, 0, W, H);
    if (W <= 0 || H <= 0) return;

    var dark = isDarkTheme();
    var isEn = document.documentElement.lang === 'en-US';

    if (activeConcept === 1) renderPrism(clock, dark, isEn);
    else if (activeConcept === 2) renderCapsuleConduit(clock, dark, isEn);
    else if (activeConcept === 3) renderCardSlide(clock, dark, isEn);
    else if (activeConcept === 4) renderMultiplayerAirDrop(clock, dark, isEn);
  }

  function loop(now) {
    if (!running) return;
    draw(now);
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
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function init() {
    resize();
    window.addEventListener('resize', resize);

    var host = wrapper || canvas;
    if (host) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
      host.addEventListener('click', onClick);
    }

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        inView = entries[0] && entries[0].isIntersecting;
        if (inView) play();
        else pause();
      }, { threshold: 0.05 });
      io.observe(canvas);
    } else {
      play();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
