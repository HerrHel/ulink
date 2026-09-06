/*
 * 与链 ulink — Hero 主视觉「书签星图」（/ 首页专用，Canvas 2D，零依赖）
 *
 * 叙事与产品同构：点 = 书签，线 = 链接与关联，带光环的节点 = 分组（卫星节点
 * 环绕轨道运行），2-3 个节点以品牌链条形状勾勒（呼应 logo）。
 *
 * 交互：指针深度视差（按景深 z 分层偏移）+ 指针邻近的连线增亮。
 * 性能：节点数按面积自适应并封顶、DPR 上限 2、glow 用预渲染精灵而非
 * shadowBlur、dt 驱动、hero 滚出视口 / 页签隐藏即暂停 rAF。
 * 可访问性：prefers-reduced-motion → 渲染单帧静态星图；canvas aria-hidden。
 *
 * 颜色与 index.html 内联 CSS 的设计令牌保持一致（--night/--cream/--glow），
 * 修改品牌色时两处同步。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('constellation');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement; // .stars（overflow:hidden，尺寸即 hero）
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 调色 ── */
  var GLOW_BLUE = '143,176,255';   // --glow：连线/淡蓝节点
  var GLOW_CREAM = '245,239,234';  // --cream：米白节点
  var LINK_COLOR = GLOW_BLUE;

  /* ── 状态 ── */
  var W = 0, H = 0, DPR = 1;
  var nodes = [];        // {x,y,z,vx,vy,r,kind,phase,twinkle,color,orbit?}
  var groups = [];       // 分组节点索引（卫星随其公转）
  var linkDist = 130;
  var pointer = { tx: 0, ty: 0, x: 0, y: 0, cx: -9999, cy: -9999 }; // 视差目标/当前 + 画布坐标
  var rafId = 0, running = false, lastT = 0, elapsed = 0;
  var inView = true;

  /* ── glow 精灵：预渲染径向渐变，drawImage 复用（远快于 shadowBlur） ── */
  function makeGlow(rgb) {
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(' + rgb + ',1)');
    grad.addColorStop(0.25, 'rgba(' + rgb + ',.5)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return s;
  }
  var spriteBlue = makeGlow(GLOW_BLUE);
  var spriteCream = makeGlow(GLOW_CREAM);

  // 品牌链条 logo 路径（与 manifest/favicon 同源，24×24 视箱）
  var chainPath = new Path2D('M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71 M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71');

  /* ── 场景构建 ── */
  function rand(a, b) { return a + Math.random() * (b - a); }

  function build() {
    nodes = [];
    groups = [];
    var count = Math.round((W * H) / 14000);
    count = Math.max(40, Math.min(120, count));
    var i, n;
    for (i = 0; i < count; i++) {
      var z = rand(0.35, 1); // 景深：0.35 远 → 1 近
      nodes.push({
        x: rand(0, W), y: rand(0, H), z: z,
        vx: rand(-5, 5), vy: rand(-5, 5),          // px/s，缓慢漂移
        r: rand(1.1, 2.6) * z,
        kind: 'dot',
        phase: rand(0, Math.PI * 2),
        twinkle: rand(0.4, 1.1),                    // 明暗呼吸频率
        color: Math.random() < 0.72 ? GLOW_CREAM : GLOW_BLUE,
        alpha: rand(0.5, 1)
      });
    }
    // 3 个「分组」节点：更亮更大，带光环；从普通节点中挑 4 个改成其卫星
    var GROUPS = 3;
    for (i = 0; i < GROUPS; i++) {
      var g = nodes[Math.floor((i + 0.5) / GROUPS * nodes.length)];
      g.kind = 'group';
      g.r = 3.2 * g.z;
      g.color = GLOW_CREAM;
      g.alpha = 1;
      g.orbitR = rand(26, 40) * g.z;
      g.orbitW = rand(0.25, 0.45) * (i % 2 ? 1 : -1); // rad/s，方向交替
      groups.push(g);
      for (var k = 0; k < 4; k++) {
        var sat = nodes[(nodes.indexOf(g) + 3 + k * 7) % nodes.length];
        if (sat.kind !== 'dot') continue;
        sat.kind = 'sat';
        sat.host = g;
        sat.orbitA = (k / 4) * Math.PI * 2 + rand(-0.3, 0.3);
        // 构建期即落位到轨道（静态单帧渲染时无需等 update）
        sat.x = g.x + Math.cos(sat.orbitA) * g.orbitR;
        sat.y = g.y + Math.sin(sat.orbitA) * g.orbitR * 0.7;
      }
    }
    // 2 个链条形状节点（品牌点缀）
    var placed = 0;
    for (i = 0; i < nodes.length && placed < 2; i++) {
      if (nodes[i].kind === 'dot' && nodes[i].z > 0.75 && i % 5 === 0) {
        nodes[i].kind = 'chain';
        nodes[i].r = 4.4 * nodes[i].z;
        placed++;
      }
    }
    linkDist = Math.max(90, Math.min(150, Math.min(W, H) * 0.16));
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
    if (reducedMotion) draw(0); // 静态：单帧
  }

  /* ── 更新 ── */
  function update(dt) {
    elapsed += dt;
    var m = 30, i, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.kind === 'sat') {
        n.orbitA += n.host.orbitW * dt * 0.6;
        n.x = n.host.x + Math.cos(n.orbitA) * n.host.orbitR;
        n.y = n.host.y + Math.sin(n.orbitA) * n.host.orbitR * 0.7; // 椭圆轨道
        continue;
      }
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (n.x < -m) n.x = W + m; else if (n.x > W + m) n.x = -m;
      if (n.y < -m) n.y = H + m; else if (n.y > H + m) n.y = -m;
    }
    // 指针视差缓动
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3.2);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3.2);
  }

  /* ── 绘制 ── */
  function nodePos(n) { // 含视差层偏移（近景偏移大）
    return {
      x: n.x + pointer.x * 16 * n.z,
      y: n.y + pointer.y * 16 * n.z
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var i, j, n, p;

    // 连线在下层
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + LINK_COLOR + ',0)';
    var d2, dx, dy, a, boost;
    var px = pointer.cx, py = pointer.cy;
    for (i = 0; i < nodes.length; i++) {
      var ni = nodePos(nodes[i]);
      for (j = i + 1; j < nodes.length; j++) {
        var nj = nodePos(nodes[j]);
        dx = ni.x - nj.x; dy = ni.y - nj.y;
        if (dx > linkDist || dx < -linkDist || dy > linkDist || dy < -linkDist) continue;
        d2 = dx * dx + dy * dy;
        if (d2 > linkDist * linkDist) continue;
        a = 1 - Math.sqrt(d2) / linkDist;
        a = a * a * 0.42 * Math.min(nodes[i].z, nodes[j].z);
        // 指针邻近增亮
        boost = 0;
        if (px > -999) {
          var mx = (ni.x + nj.x) / 2 - px, my = (ni.y + nj.y) / 2 - py;
          var md2 = mx * mx + my * my;
          if (md2 < 160 * 160) boost = 1 - Math.sqrt(md2) / 160;
        }
        ctx.strokeStyle = 'rgba(' + LINK_COLOR + ',' + (a * (1 + boost * 1.4)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ni.x, ni.y);
        ctx.lineTo(nj.x, nj.y);
        ctx.stroke();
      }
    }

    // 节点在上层
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      p = nodePos(n);
      var tw = n.alpha * (0.72 + 0.28 * Math.sin(n.phase + elapsed * n.twinkle));
      var size = n.r * 6;

      if (n.kind === 'chain') {
        ctx.drawImage(spriteCream, p.x - size / 2, p.y - size / 2, size, size);
        var s = (n.r * 2.2) / 24;
        ctx.save();
        ctx.translate(p.x - 12 * s, p.y - 12 * s);
        ctx.scale(s, s);
        ctx.strokeStyle = 'rgba(' + GLOW_CREAM + ',' + Math.min(1, tw + 0.3).toFixed(3) + ')';
        ctx.lineWidth = 2.5 / s * 0.8;
        ctx.lineCap = 'round';
        ctx.stroke(chainPath);
        ctx.restore();
        continue;
      }
      if (n.kind === 'group') {
        // 光环 + 双环
        ctx.drawImage(spriteCream, p.x - size * 1.15, p.y - size * 1.15, size * 2.3, size * 2.3);
        ctx.strokeStyle = 'rgba(' + GLOW_CREAM + ',' + (0.35 * tw).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, n.r * 2.6, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = 'rgba(' + GLOW_BLUE + ',' + (0.22 * tw).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, n.r * 3.7, 0, 6.2832); ctx.stroke();
        continue;
      }
      var sprite = n.color === GLOW_BLUE ? spriteBlue : spriteCream;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, tw));
      ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  /* ── 主循环 ── */
  function frame(t) {
    if (!running) return;
    var dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    update(dt);
    draw();
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

  /* ── 指针：视差目标 + 增亮定位（画布坐标） ── */
  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    pointer.cx = e.clientX - rect.left;
    pointer.cy = e.clientY - rect.top;
    pointer.tx = (pointer.cx / Math.max(1, W) - 0.5) * 2;
    pointer.ty = (pointer.cy / Math.max(1, H) - 0.5) * 2;
  }
  function onPointerLeave() {
    pointer.tx = 0; pointer.ty = 0;
    pointer.cx = -9999; pointer.cy = -9999;
  }

  /* ── 生命周期 ── */
  function start() {
    resize();
    if (reducedMotion) return; // 单帧已在 resize 中绘制
    var host = canvas.closest('.hero') || wrapper;
    if (host) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
    }
    // hero 滚出视口即暂停（省电），回到视口恢复
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
    var resizeTimer = 0;
    var onResize = function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    };
    if ('ResizeObserver' in window && wrapper) {
      new ResizeObserver(onResize).observe(wrapper);
    } else {
      window.addEventListener('resize', onResize);
    }
    play();
  }

  start();
})();
