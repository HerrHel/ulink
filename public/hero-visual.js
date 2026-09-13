/*
 * 与链 ulink — Hero 主视觉「星链 · 精工几何星网」（/ 首页专用，Canvas 2D，零依赖）
 *
 * 叙事隐喻：
 * 中心为「与链」精工双环徽标核心，四周节点沿克制的天球轨道缓缓运行，
 * 节点与中心通过渐变能量连线相牵引（如万千网址归集入库）；
 * 周期性有节点向中心射出一道渐变流光（Light Streak），在中心激起纯净的双波涟漪；
 * 鼠标滑过时，邻近节点平滑唤醒增亮，充满温润而灵动的交互呼吸感。
 *
 * 审美与工艺设计（借鉴 Linear / Stripe 等顶级站点的克制美学）：
 * 1. 纯 2D 原生向量渲染，数学保证 100% 稳定，零 3D 穿模，零锯齿；
 * 2. 渐变能量光丝（Linear Gradient）：告别纯色生硬线条，两端自发光；
 * 3. 精致微晶节点：白晶内核 + 品牌深蓝/皇家蓝/翡翠绿外圈 + 柔和呼吸光晕；
 * 4. 中心双环徽标微盘：高透白磨砂微盘内嵌精密「与链」交叠双环矢量标记；
 * 5. 极简秩序天球环：极细微的背景椭圆引导环，提供宁静的运行秩序，绝不杂乱。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('constellation');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement;
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 色彩令牌 ── */
  var BRAND = '18,46,138';       // #122E8A 品牌深海蓝
  var ACCENT = '59,130,246';     // #3B82F6 皇家亮蓝
  var TEAL = '16,185,129';       // #10B981 翡翠绿

  /* ── 状态池 ── */
  var W = 0, H = 0, DPR = 1;
  var hub = { x: 0, y: 0, r: 18, flash: 0 };
  var nodes = [];
  var guideOrbits = [];
  var chords = [];
  var pulses = [];
  var ripples = [];
  var nextPulseAt = 1.8;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false, mouseCanvasX: 0, mouseCanvasY: 0 };
  var rafId = 0, running = false, lastT = 0, inView = true;

  // 预渲染高质感径向光晕精灵（离屏缓存，零 shadowBlur 性能开销）
  function makeGlow(rgb, size) {
    var s = document.createElement('canvas');
    s.width = s.height = size;
    var g = s.getContext('2d');
    var half = size / 2;
    var grad = g.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(' + rgb + ', 0.65)');
    grad.addColorStop(0.35, 'rgba(' + rgb + ', 0.2)');
    grad.addColorStop(1, 'rgba(' + rgb + ', 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return s;
  }

  var spriteAccent = makeGlow(ACCENT, 64);
  var spriteTeal = makeGlow(TEAL, 64);

  // 绘制与链官方品牌矢量徽标（U-Knot 与字结）
  function drawBrandLogo(ctx, cx, cy, size, bgColor) {
    ctx.save();
    ctx.translate(cx, cy);
    var s = size / 2;
    var lw = s * (26 / 120);
    var gapLw = s * (38 / 120);
    var bg = bgColor || '#FFFFFF';

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

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
    ctx.strokeStyle = blueColor;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-0.8 * s, -0.2 * s);
    ctx.lineTo(0, -0.2 * s);
    ctx.bezierCurveTo((7 / 15) * s, -0.2 * s, 0.6 * s, -(2 / 15) * s, 0.6 * s, 0.2 * s);
    ctx.bezierCurveTo(0.6 * s, (8 / 15) * s, (7 / 15) * s, 0.6 * s, 0, 0.6 * s);
    ctx.lineTo(-0.6 * s, 0.6 * s);
    ctx.stroke();

    // 2. Optical Gap at Crossing 2
    ctx.strokeStyle = bg;
    ctx.lineWidth = gapLw;
    ctx.beginPath();
    ctx.moveTo((53 / 120) * s, 0.2 * s);
    ctx.lineTo((91 / 120) * s, 0.2 * s);
    ctx.stroke();

    // 3. Full Green shape (G2 Bézier)
    ctx.strokeStyle = greenColor;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(0.8 * s, 0.2 * s);
    ctx.lineTo(0, 0.2 * s);
    ctx.bezierCurveTo(-(7 / 15) * s, 0.2 * s, -0.6 * s, (2 / 15) * s, -0.6 * s, -0.2 * s);
    ctx.bezierCurveTo(-0.6 * s, -(8 / 15) * s, -(7 / 15) * s, -0.6 * s, 0, -0.6 * s);
    ctx.lineTo(0.6 * s, -0.6 * s);
    ctx.stroke();

    // 4. Optical Gap at Crossing 1
    ctx.strokeStyle = bg;
    ctx.lineWidth = gapLw;
    ctx.beginPath();
    ctx.moveTo(-(91 / 120) * s, -0.2 * s);
    ctx.lineTo(-(53 / 120) * s, -0.2 * s);
    ctx.stroke();

    // 5. Seamless re-stroke Blue top line
    ctx.strokeStyle = blueColor;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(-0.8 * s, -0.2 * s);
    ctx.lineTo(0, -0.2 * s);
    ctx.stroke();

    ctx.restore();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    if (!wrapper) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = wrapper.clientWidth;
    H = wrapper.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
    if (reducedMotion) draw(0);
  }

  function build() {
    hub.x = W / 2;
    hub.y = H / 2;
    var base = Math.min(W, H);

    // 三条克制的背景天球椭圆轨道（如瑞士钟表刻度发丝线，提供空间秩序）
    guideOrbits = [
      { r: base * 0.25, rot: 0.1 },
      { r: base * 0.38, rot: -0.08 },
      { r: base * 0.49, rot: 0.05 }
    ];

    nodes = [];
    chords = [];
    pulses = [];
    ripples = [];

    var count = Math.max(8, Math.min(12, Math.round(base / 40)));
    for (var i = 0; i < count; i++) {
      var orbitIdx = i % 3;
      var orb = guideOrbits[orbitIdx];
      var isMajor = i < 3;
      var isTeal = i === 1 || i === 4;

      nodes.push({
        id: i,
        orbitR: orb.r * rand(0.94, 1.06),
        angle: (i / count) * Math.PI * 2 + rand(-0.2, 0.2),
        speed: rand(0.04, 0.08) * (i % 2 === 0 ? 1 : -1),
        r: isMajor ? rand(3.8, 4.4) : rand(2.4, 3.2),
        isMajor: isMajor,
        colorType: isTeal ? 'teal' : isMajor ? 'accent' : 'brand',
        phase: rand(0, Math.PI * 2),
        tw: rand(0.8, 1.6),
        hoverFactor: 0,
        px: 0, py: 0
      });
    }

    // 少量两两弦线（带来轻量有机拓扑感）
    for (var k = 0; k < nodes.length; k++) {
      var j = (k + 2) % nodes.length;
      if (j !== k && Math.abs(nodes[k].orbitR - nodes[j].orbitR) < base * 0.18) {
        chords.push([k, j]);
      }
    }
  }

  function update(dt, t) {
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3.5);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3.5);

    if (hub.flash > 0) hub.flash = Math.max(0, hub.flash - dt * 2.5);

    var base = Math.min(W, H);
    var squash = 0.88;

    // 节点位置与鼠标邻近感应
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.angle += n.speed * dt;

      var wob = 1 + 0.03 * Math.sin(t * 0.4 + n.phase);
      var x = hub.x + Math.cos(n.angle) * n.orbitR * wob + pointer.x * (n.isMajor ? 12 : 7);
      var y = hub.y + Math.sin(n.angle) * n.orbitR * wob * squash + pointer.y * (n.isMajor ? 12 : 7);

      n.px = x;
      n.py = y;

      if (pointer.active) {
        var dx = pointer.mouseCanvasX - x;
        var dy = pointer.mouseCanvasY - y;
        var dist = Math.hypot(dx, dy);
        var triggerDist = base * 0.22;
        if (dist < triggerDist) {
          n.hoverFactor += ((1 - dist / triggerDist) - n.hoverFactor) * Math.min(1, dt * 6);
        } else {
          n.hoverFactor += (0 - n.hoverFactor) * Math.min(1, dt * 4);
        }
      } else {
        n.hoverFactor += (0 - n.hoverFactor) * Math.min(1, dt * 4);
      }
    }

    // 脉冲生成
    nextPulseAt -= dt;
    if (nextPulseAt <= 0 && nodes.length) {
      nextPulseAt = rand(2.2, 3.8);
      var src = nodes[Math.floor(Math.random() * nodes.length)];
      pulses.push({
        node: src,
        progress: 0,
        dur: rand(1.1, 1.4)
      });
    }

    // 脉冲推进
    for (var p = pulses.length - 1; p >= 0; p--) {
      var pu = pulses[p];
      pu.progress += dt / pu.dur;
      if (pu.progress >= 1) {
        pulses.splice(p, 1);
        hub.flash = 1;
        ripples.push({ r: 18, alpha: 0.65, speed: 65, lw: 1.6 });
      }
    }

    // 涟漪推进
    for (var r = ripples.length - 1; r >= 0; r--) {
      var rp = ripples[r];
      rp.r += rp.speed * dt;
      rp.alpha -= dt * 0.75;
      if (rp.alpha <= 0) ripples.splice(r, 1);
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var base = Math.min(W, H);
    var squash = 0.88;
    var i;

    // ── 1. 克制纯净的几何天球轨道 ──
    for (var o = 0; o < guideOrbits.length; o++) {
      var orb = guideOrbits[o];
      ctx.save();
      ctx.translate(hub.x, hub.y);
      ctx.scale(1, squash);
      ctx.rotate(orb.rot);

      ctx.beginPath();
      ctx.arc(0, 0, orb.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + BRAND + ', 0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    }

    // ── 2. 节点连向中心的渐变能量线 ──
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var lineAlpha = 0.12 + n.hoverFactor * 0.35;

      var lineGrad = ctx.createLinearGradient(n.px, n.py, hub.x, hub.y);
      var cRGB = n.colorType === 'teal' ? TEAL : n.colorType === 'accent' ? ACCENT : BRAND;
      lineGrad.addColorStop(0, 'rgba(' + cRGB + ',' + (lineAlpha * 1.8).toFixed(3) + ')');
      lineGrad.addColorStop(0.7, 'rgba(' + BRAND + ',' + (lineAlpha * 0.8).toFixed(3) + ')');
      lineGrad.addColorStop(1, 'rgba(' + BRAND + ', 0.02)');

      ctx.beginPath();
      ctx.moveTo(n.px, n.py);
      ctx.lineTo(hub.x, hub.y);
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 1.0 + n.hoverFactor * 0.8;
      ctx.stroke();
    }

    // ── 3. 弦线（节点呼应网感） ──
    for (var k = 0; k < chords.length; k++) {
      var n1 = nodes[chords[k][0]], n2 = nodes[chords[k][1]];
      var cAlpha = 0.06 + Math.max(n1.hoverFactor, n2.hoverFactor) * 0.18;
      ctx.beginPath();
      ctx.moveTo(n1.px, n1.py);
      ctx.lineTo(n2.px, n2.py);
      ctx.strokeStyle = 'rgba(' + BRAND + ',' + cAlpha.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── 4. 沿连线流动的渐变流光痕（Streak） ──
    for (var p = 0; p < pulses.length; p++) {
      var pulse = pulses[p];
      var src = pulse.node;
      var prog = pulse.progress;

      var trailLen = 0.22;
      var headProg = prog;
      var tailProg = Math.max(0, prog - trailLen);

      var hx = src.px + (hub.x - src.px) * headProg;
      var hy = src.py + (hub.y - src.py) * headProg;
      var tx = src.px + (hub.x - src.px) * tailProg;
      var ty = src.py + (hub.y - src.py) * tailProg;

      var pGrad = ctx.createLinearGradient(tx, ty, hx, hy);
      pGrad.addColorStop(0, 'rgba(' + ACCENT + ', 0)');
      pGrad.addColorStop(0.6, 'rgba(' + ACCENT + ', 0.65)');
      pGrad.addColorStop(1, 'rgba(255, 255, 255, 0.95)');

      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = pGrad;
      ctx.lineWidth = 2.0;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 5. 中心吸收涟漪 ──
    for (var r = 0; r < ripples.length; r++) {
      var rp = ripples[r];
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + ACCENT + ',' + rp.alpha.toFixed(3) + ')';
      ctx.lineWidth = rp.lw;
      ctx.stroke();
    }

    // ── 6. 中心「与链」精工微盘徽章（Precision Core Badge） ──
    var hubGlowR = base * (0.28 + hub.flash * 0.08);
    var hubGlowGrad = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, hubGlowR);
    hubGlowGrad.addColorStop(0, 'rgba(79, 124, 255, ' + (0.22 + hub.flash * 0.2).toFixed(3) + ')');
    hubGlowGrad.addColorStop(0.5, 'rgba(18, 46, 138, 0.06)');
    hubGlowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = hubGlowGrad;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hubGlowR, 0, Math.PI * 2);
    ctx.fill();

    // 磨砂白微盘底座
    var discR = 20 * (1 + hub.flash * 0.15);
    ctx.shadowColor = 'rgba(18, 46, 138, 0.15)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, discR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = 'rgba(' + BRAND + ', 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 徽标矢量（与链 U-Knot）
    drawBrandLogo(ctx, hub.x, hub.y, 24 * (1 + hub.flash * 0.1), '#FFFFFF');

    // ── 7. 星网节点（精致微晶发光圆点） ──
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var tw = 0.8 + 0.2 * Math.sin(t * nd.tw + nd.phase);
      var sprite = nd.colorType === 'teal' ? spriteTeal : spriteAccent;
      var nodeRGB = nd.colorType === 'teal' ? TEAL : nd.colorType === 'accent' ? ACCENT : BRAND;

      var currentR = nd.r * (1 + nd.hoverFactor * 0.35);
      var glowR = currentR * 6.0;

      ctx.drawImage(sprite, nd.px - glowR / 2, nd.py - glowR / 2, glowR, glowR);

      if (nd.isMajor) {
        ctx.beginPath();
        ctx.arc(nd.px, nd.py, currentR * 2.1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(' + nodeRGB + ',' + (0.28 * tw + nd.hoverFactor * 0.4).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(' + nodeRGB + ',' + (0.92 * tw).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(nd.px, nd.py, currentR, 0, Math.PI * 2);
      ctx.fill();

      // 微晶白核
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(nd.px, nd.py, currentR * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(ts) {
    if (!running) return;
    var dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    var t = ts / 1000;
    update(dt, t);
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
    pointer.mouseCanvasX = (e.clientX - rect.left);
    pointer.mouseCanvasY = (e.clientY - rect.top);
    pointer.tx = (pointer.mouseCanvasX / Math.max(1, W) - 0.5) * 2;
    pointer.ty = (pointer.mouseCanvasY / Math.max(1, H) - 0.5) * 2;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.tx = 0; pointer.ty = 0; pointer.active = false;
  }

  function start() {
    resize();
    if (reducedMotion) return;

    var host = canvas.closest('.hero') || wrapper;
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
