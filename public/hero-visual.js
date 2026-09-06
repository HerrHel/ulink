/*
 * 与链 ulink — Hero 主视觉「星链」（/ 首页专用，Canvas 2D，零依赖）
 *
 * 叙事：中心一颗最亮的星 = 与链站点，四周较小的站点节点沿椭圆轨道缓慢流转，
 * 各自连向中心（星链）；每隔几秒一颗节点向中心发出一道「脉冲」——一枚光点
 * 沿连线流入，中心泛起涟漪：像又有网页被收进库里。
 * 浅色设计：画布置于主页面底色 #F5EFEA 之上，节点/连线用品牌蓝 #122E8A 系。
 *
 * 交互：指针轻视差（按节点半径分层）。
 * 性能：节点数按面积自适应、DPR 上限 2、glow 用预渲染精灵而非 shadowBlur、
 * dt 驱动、hero 滚出视口 / 页签隐藏即暂停 rAF。
 * 可访问性：prefers-reduced-motion → 渲染单帧静态星链；canvas aria-hidden。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('constellation');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement; // .hero-visual（容器即视口）
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 调色（与 index.html 内联 CSS 的品牌令牌一致，改色两处同步） ── */
  var BRAND = '18,46,138';        // #122E8A 主站主题色
  var BRAND_SOFT = '79,124,255';  // 亮蓝节点点缀

  /* ── 状态 ── */
  var W = 0, H = 0, DPR = 1;
  var hub = { x: 0, y: 0 };
  var nodes = [];        // 轨道站点节点
  var chords = [];       // 少量节点间弦线 [i, j]
  var pulses = [];       // 流入中心的光点
  var ripples = [];      // 中心涟漪
  var nextPulseAt = 1.6;
  var elapsed = 0;
  var pointer = { tx: 0, ty: 0, x: 0, y: 0 };
  var rafId = 0, running = false, lastT = 0, inView = true;

  /* ── glow 精灵：预渲染径向渐变，drawImage 复用 ── */
  function makeGlow(rgb) {
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(' + rgb + ',.55)');
    grad.addColorStop(0.4, 'rgba(' + rgb + ',.18)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return s;
  }
  var spriteBrand = makeGlow(BRAND);
  var spriteSoft = makeGlow(BRAND_SOFT);

  /* ── 场景构建 ── */
  function rand(a, b) { return a + Math.random() * (b - a); }

  function build() {
    nodes = [];
    chords = [];
    pulses = [];
    ripples = [];
    hub.x = W / 2; hub.y = H / 2;
    var base = Math.min(W, H);
    var count = Math.round(base / 42);
    count = Math.max(8, Math.min(14, count));
    for (var i = 0; i < count; i++) {
      var frac = (i + 0.55) / count;                 // 半径错开，避免环带重叠
      nodes.push({
        R: base * (0.24 + 0.32 * frac + rand(-0.03, 0.05)),
        a: (i / count) * Math.PI * 2 + rand(-0.25, 0.25),
        w: rand(0.05, 0.11) * (i % 2 ? 1 : -1),      // rad/s：一圈约 1-2 分钟
        r: rand(2.4, 4.4),
        soft: i % 3 === 1,                            // 约 1/3 用亮蓝点缀
        phase: rand(0, Math.PI * 2),
        tw: rand(0.5, 1),
        px: 0, py: 0
      });
    }
    // 少量弦线：相邻半径节点相连，形成「链与链」的网感
    for (var k = 0; k < nodes.length; k++) {
      var j = (k + 2) % nodes.length;
      if (j !== k && Math.abs(nodes[k].R - nodes[j].R) < base * 0.16) chords.push([k, j]);
    }
  }

  /* ── 节点当前位置（含视差） ── */
  function nodePos(n, t) {
    var wob = 1 + 0.045 * Math.sin(t * 0.35 + n.phase);   // 半径微呼吸
    var squash = H > W ? 0.92 : 0.86;                      // 椭圆轨道压扁率
    return {
      x: hub.x + Math.cos(n.a) * n.R * wob + pointer.x * 8,
      y: hub.y + Math.sin(n.a) * n.R * wob * squash + pointer.y * 8
    };
  }

  /* ── 尺寸 ── */
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

  /* ── 更新 ── */
  function update(dt, t) {
    elapsed = t;
    var i, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      n.a += n.w * dt;
      var p = nodePos(n, t);
      n.px = p.x; n.py = p.y;
    }
    // 脉冲生成
    nextPulseAt -= dt;
    if (nextPulseAt <= 0 && nodes.length) {
      nextPulseAt = rand(2.2, 4.2);
      var src = nodes[Math.floor(Math.random() * nodes.length)];
      pulses.push({ node: src, t: 0, dur: rand(1.1, 1.5) });
    }
    // 脉冲推进
    for (i = pulses.length - 1; i >= 0; i--) {
      var pu = pulses[i];
      pu.t += dt / pu.dur;
      if (pu.t >= 1) {
        pulses.splice(i, 1);
        ripples.push({ r: 10, alpha: 0.5 });
      }
    }
    // 涟漪推进
    for (i = ripples.length - 1; i >= 0; i--) {
      var rp = ripples[i];
      rp.r += 42 * dt;
      rp.alpha -= 0.75 * dt;
      if (rp.alpha <= 0) ripples.splice(i, 1);
    }
    // 视差缓动
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
  }

  /* ── 绘制 ── */
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var i, k;

    // 中心辉光（最亮的星）
    var hubGlow = Math.min(W, H) * 0.34;
    ctx.drawImage(spriteBrand, hub.x - hubGlow / 2, hub.y - hubGlow / 2, hubGlow, hubGlow);
    // 涟漪
    for (i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      ctx.strokeStyle = 'rgba(' + BRAND + ',' + rp.alpha.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hub.x, hub.y, rp.r, 0, 6.2832); ctx.stroke();
    }
    // 连线：节点 → 中心
    ctx.lineWidth = 1;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var p = n.px ? { x: n.px, y: n.py } : nodePos(n, t);
      var d = Math.hypot(p.x - hub.x, p.y - hub.y);
      var a = Math.max(0.06, 0.26 - d / (Math.min(W, H) * 2.2));
      a *= 0.8 + 0.2 * Math.sin(n.phase + elapsed * n.tw);
      ctx.strokeStyle = 'rgba(' + BRAND + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    // 弦线（链与链）
    for (k = 0; k < chords.length; k++) {
      var n1 = nodes[chords[k][0]], n2 = nodes[chords[k][1]];
      var p1 = n1.px ? { x: n1.px, y: n1.py } : nodePos(n1, t);
      var p2 = n2.px ? { x: n2.px, y: n2.py } : nodePos(n2, t);
      ctx.strokeStyle = 'rgba(' + BRAND + ',0.08)';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    // 节点
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      var pp = nd.px ? { x: nd.px, y: nd.py } : nodePos(nd, t);
      var tw = 0.72 + 0.28 * Math.sin(nd.phase + elapsed * nd.tw);
      var glowR = nd.r * 6.5;
      ctx.drawImage(nd.soft ? spriteSoft : spriteBrand, pp.x - glowR / 2, pp.y - glowR / 2, glowR, glowR);
      ctx.fillStyle = 'rgba(' + (nd.soft ? BRAND_SOFT : BRAND) + ',' + (0.85 * tw).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(pp.x, pp.y, nd.r, 0, 6.2832); ctx.fill();
    }
    // 中心本体：白核 + 蓝环
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 5.2, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(' + BRAND + ',0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 7.4, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + BRAND + ',0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 11.5, 0, 6.2832); ctx.stroke();
    // 脉冲光点（沿连线流向中心）
    for (i = 0; i < pulses.length; i++) {
      var pu2 = pulses[i];
      var sn = pu2.node;
      var sp = sn.px ? { x: sn.px, y: sn.py } : nodePos(sn, t);
      var e = pu2.t < 0.5 ? 2 * pu2.t * pu2.t : 1 - Math.pow(-2 * pu2.t + 2, 2) / 2; // easeInOut
      var x = sp.x + (hub.x - sp.x) * e;
      var y = sp.y + (hub.y - sp.y) * e;
      var pr = 2.6 + 1.2 * e;
      ctx.drawImage(spriteBrand, x - pr * 2.6, y - pr * 2.6, pr * 5.2, pr * 5.2);
      ctx.fillStyle = 'rgba(' + BRAND + ',0.9)';
      ctx.beginPath(); ctx.arc(x, y, pr * 0.55, 0, 6.2832); ctx.fill();
    }
  }

  /* ── 主循环 ── */
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

  /* ── 指针 ── */
  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.tx = ((e.clientX - rect.left) / Math.max(1, W) - 0.5) * 2;
    pointer.ty = ((e.clientY - rect.top) / Math.max(1, H) - 0.5) * 2;
  }
  function onPointerLeave() { pointer.tx = 0; pointer.ty = 0; }

  /* ── 生命周期 ── */
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
    var onResize = function () { clearTimeout(timer); timer = setTimeout(resize, 150); };
    if ('ResizeObserver' in window && wrapper) new ResizeObserver(onResize).observe(wrapper);
    else window.addEventListener('resize', onResize);
    play();
  }

  start();
})();
