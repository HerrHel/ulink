/*
 * 与链 ulink — 创作与分享视觉「知识生命之树与用户分叉共生网络」
 * （/ 首页专用，Canvas 2D，零依赖，纯原生动效）
 *
 * 核心设计隐喻（Living Knowledge Tree & User Branching Network）：
 * 1. 知识生命之树（The Living Fork Tree）：
 *    - 计算机与开源文化中的「Fork」本质即是生命树的分枝分叉；
 *    - 创作者发布的精选集为生命之树的「源干根基（Origin Root）」，深沉稳固（#122E8A 品牌深蓝 + 双环徽标）；
 *    - 向右自然舒展出三次贝塞尔分形生长的有机枝脉（Organic Stems），能量从深蓝流淌蜕变为翡翠翠绿（#10B981）；
 * 2. 真实用户节点（User Leaf Nodes）：
 *    - 枝稍末端绽放出高透磨砂微盘叶核与悬挂名牌（@Elena R.、@Marcus L.、@Devin K.、@Sarah W.）；
 *    - 分别标识「本地副本」「二次创作」「独立分支」「团队同频」等多样化沉淀形态；
 * 3. 树液光子（Sap Flow Photons）：
 *    - 带有彗星拖尾的发光微晶沿着枝干向各用户节点轻盈穿梭，具象化知识的滋养与输送；
 * 4. 极致因果交互（点击即时顺势分叉）：
 *    - 点击右侧舞台任意位置，树干立刻顺势生长出一条属于当前用户的全新分支（@You (本地) · Fork 副本）；
 *    - 伴随平滑弹簧生长、高速极光穿梭注入与枝稍绽放的翡翠扩散涟漪；
 * 5. 极度克制、优雅高级，全站一致：
 *    - 继承 Hero/Sync 磨砂玻璃盘、天球轨道虚线与全站设计令牌（#FDFBF9, #E5DDD3, #2C2824）；
 *    - 完善的无障碍降级（prefers-reduced-motion）、视口休眠（IntersectionObserver）与 Retina 高清适配。
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

  var W = 0, H = 0, DPR = 1;
  var pointer = { x: -1000, y: -1000, tx: 0, ty: 0, active: false };
  var lastT = 0, rafId = 0, running = false, inView = true;
  var clock = 0;

  var ripples = [];
  var sapPhotons = [];
  var root = { x: 0, y: 0 };

  // 优雅的自然分枝拓扑系统
  // 主干向右展开，分出主脉与次级分叉，并在枝梢处自然绽放用户节点
  var branches = [
    // 0. 主干（Root -> Trunk Center）
    {
      id: 't1',
      startFrom: 'root',
      cp1: { rx: 0.22, ry: 0.49 },
      cp2: { rx: 0.29, ry: 0.48 },
      end: { rx: 0.36, ry: 0.48 },
      tGrowth: 1.0,
      isTrunk: true,
      lineWidth: 2.6
    },
    // 1. 上主枝（Trunk -> Elena）
    {
      id: 'b_upper',
      startFrom: 't1',
      cp1: { rx: 0.44, ry: 0.41 },
      cp2: { rx: 0.52, ry: 0.23 },
      end: { rx: 0.92, ry: 0.20, isLeaf: true },
      tGrowth: 1.0,
      lineWidth: 1.6,
      user: { name: 'Elena R.', roleZh: '本地副本', roleEn: 'Local Fork', color: '#10B981' }
    },
    // 2. 上次生细枝（Upper Sub -> Marcus）
    {
      id: 'b_upper_sub',
      startFrom: 'b_upper',
      subT: 0.52,
      parentBrId: 'b_upper',
      cp1: { rx: 0.56, ry: 0.32 },
      cp2: { rx: 0.64, ry: 0.37 },
      end: { rx: 1.00, ry: 0.38, isLeaf: true },
      tGrowth: 1.0,
      lineWidth: 1.2,
      user: { name: 'Marcus L.', roleZh: '二次创作', roleEn: 'Derivation', color: '#059669' }
    },
    // 3. 中主枝（Trunk -> Devin）
    {
      id: 'b_mid',
      startFrom: 't1',
      cp1: { rx: 0.46, ry: 0.49 },
      cp2: { rx: 0.56, ry: 0.56 },
      end: { rx: 0.98, ry: 0.58, isLeaf: true },
      tGrowth: 1.0,
      lineWidth: 1.6,
      user: { name: 'Devin K.', roleZh: '独立分支', roleEn: 'Branch', color: '#10B981' }
    },
    // 4. 下主枝（Trunk -> Sarah）
    {
      id: 'b_lower',
      startFrom: 't1',
      cp1: { rx: 0.44, ry: 0.58 },
      cp2: { rx: 0.52, ry: 0.74 },
      end: { rx: 0.90, ry: 0.80, isLeaf: true },
      tGrowth: 1.0,
      lineWidth: 1.6,
      user: { name: 'Sarah W.', roleZh: '团队同频', roleEn: 'Sync', color: '#34D399' }
    }
  ];

  // 树液光子（Sap Flow Photons）
  for (var p = 0; p < 8; p++) {
    sapPhotons.push({
      branchIdx: 1 + (p % (branches.length - 1)),
      t: Math.random(),
      speed: 0.003 + Math.random() * 0.0022,
      size: 2.6 + Math.random() * 1.3
    });
  }

  function getLeafMaxX() {
    return Math.max(W * 0.54, W - 146);
  }

  function resize() {
    if (!wrapper) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = wrapper.clientWidth;
    H = wrapper.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    root.x = Math.max(54, Math.min(84, W * 0.15));
    root.y = H * 0.48;

    if (reducedMotion) drawStatic();
  }

  function onPointerMove(e) {
    var rect = canvas.getBoundingClientRect();
    var rawX = e.clientX - rect.left;
    var rawY = e.clientY - rect.top;
    pointer.x = rawX;
    pointer.y = rawY;
    pointer.tx = (rawX - W * 0.5) / Math.max(1, W * 0.5);
    pointer.ty = (rawY - H * 0.5) / Math.max(1, H * 0.5);
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.x = -1000;
    pointer.y = -1000;
    pointer.tx = 0;
    pointer.ty = 0;
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

  // 计算树枝某点的坐标（三次贝塞尔曲线）
  function getBranchPoint(br, t) {
    var p0;
    var leafMaxX = getLeafMaxX();
    var trunkX = W * 0.36;

    if (br.startFrom === 'root') {
      p0 = root;
    } else if (br.startFrom === 't1') {
      p0 = { x: trunkX, y: branches[0].end.ry * H };
    } else if (br.parentBrId) {
      var pBr = branches.find(function (b) { return b.id === br.parentBrId; });
      p0 = pBr ? getBranchPoint(pBr, br.subT || 0.5) : root;
    } else {
      p0 = root;
    }

    var swayY = pointer.active ? pointer.ty * 4 : 0;
    var cp1 = {
      x: br.cp1.rx * W,
      y: br.cp1.ry * H + swayY
    };
    var cp2 = {
      x: br.cp2.rx * W,
      y: br.cp2.ry * H
    };

    var endX = br.end.isLeaf
      ? trunkX + (leafMaxX - trunkX) * br.end.rx
      : (br.end.rx * W);
    var p3 = {
      x: endX,
      y: br.end.ry * H
    };

    var u = 1 - t;
    var tt = t * t;
    var uu = u * u;
    var uuu = uu * u;
    var ttt = tt * t;

    var x = uuu * p0.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * p3.x;
    var y = uuu * p0.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * p3.y;
    return { x: x, y: y };
  }

  // 顺势生长出属于当前用户的全新分支
  function spawnUserBranch(cx, cy) {
    var isEn = document.documentElement.lang === 'en-US';
    var leafMaxX = getLeafMaxX();
    var targetX = Math.min(leafMaxX, Math.max(W * 0.56, cx));
    var targetY = Math.min(H * 0.86, Math.max(H * 0.14, cy));

    // 避免与已有叶节点垂直距离过近（防重叠）
    var minGap = 34;
    for (var i = 0; i < branches.length; i++) {
      if (branches[i].user) {
        var ey = branches[i].end.ry * H;
        var diff = targetY - ey;
        if (Math.abs(diff) < minGap) {
          targetY += (diff >= 0 ? 1 : -1) * (minGap - Math.abs(diff));
        }
      }
    }
    targetY = Math.min(H * 0.86, Math.max(H * 0.14, targetY));

    var trunkX = W * 0.36;
    var trunkY = branches[0].end.ry * H;
    var relLeafX = (targetX - trunkX) / Math.max(1, leafMaxX - trunkX);

    var newBr = {
      id: 'user_' + Date.now(),
      startFrom: 't1',
      cp1: { rx: 0.46, ry: (trunkY + (targetY - trunkY) * 0.25) / H },
      cp2: { rx: Math.max(0.52, (targetX * 0.78) / W), ry: targetY / H },
      end: { rx: Math.min(1.0, Math.max(0.85, relLeafX)), ry: targetY / H, isLeaf: true },
      tGrowth: 0.02,
      growthSpeed: 0.03,
      lineWidth: 1.6,
      user: {
        name: isEn ? 'You (Local)' : 'You (本地)',
        roleZh: 'Fork 副本',
        roleEn: 'Fork Replica',
        color: '#10B981',
        isNew: true
      }
    };

    branches.push(newBr);

    // 激发高能树液光子沿新分支急速注入
    sapPhotons.push({
      branchIdx: branches.length - 1,
      t: 0,
      speed: 0.036,
      size: 3.8
    });

    // 根部激发微弱共振涟漪
    ripples.push({
      x: root.x, y: root.y,
      r: 14, maxR: 50,
      alpha: 0.7, color: '18, 46, 138'
    });
  }

  // 绘制与链官方品牌矢量徽标（U-Knot 与字结）
  function drawUlinkIcon(c, cx, cy, r) {
    c.save();
    c.translate(cx, cy);
    var s = r * 1.1;
    var lw = s * 0.22;
    var gapLw = lw * 1.58;
    var bg = '#FDFBF9';

    c.lineCap = 'round';
    c.lineJoin = 'round';

    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var blueColor = isDark ? '#4F6BFF' : '#122E8A';

    // 1. Full Blue shape
    c.strokeStyle = blueColor;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(-0.8 * s, -0.2 * s);
    c.lineTo(0, -0.2 * s);
    c.bezierCurveTo((7/15) * s, -0.2 * s, 0.6 * s, -(2/15) * s, 0.6 * s, 0.2 * s);
    c.bezierCurveTo(0.6 * s, (8/15) * s, (7/15) * s, 0.6 * s, 0, 0.6 * s);
    c.lineTo(-0.6 * s, 0.6 * s);
    c.stroke();

    // 2. Optical Gap
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = lw + 14;
    c.beginPath();
    c.moveTo(0, 0.2 * s);
    c.lineTo(0.3 * s, 0.2 * s);
    c.stroke();

    // 3. Full Green shape
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#10B981';
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(0.8 * s, 0.2 * s);
    c.lineTo(0, 0.2 * s);
    c.bezierCurveTo(-(7/15) * s, 0.2 * s, -0.6 * s, (2/15) * s, -0.6 * s, -0.2 * s);
    c.bezierCurveTo(-0.6 * s, -(8/15) * s, -(7/15) * s, -0.6 * s, 0, -0.6 * s);
    c.lineTo(0.6 * s, -0.6 * s);
    c.stroke();

    // 4. Optical Gap 1
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = lw + 14;
    c.beginPath();
    c.moveTo(0, -0.2 * s);
    c.lineTo(-0.3 * s, -0.2 * s);
    c.stroke();

    // 5. Seamless re-stroke Blue top line
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = blueColor;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(-0.8 * s, -0.2 * s);
    c.lineTo(-0.01 * s, -0.2 * s);
    c.stroke();

    c.restore();
  }

  // 绘制静态版（用于 prefers-reduced-motion）
  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    var isEn = document.documentElement.lang === 'en-US';

    // 绘制树干与枝桠
    for (var i = 0; i < branches.length; i++) {
      var br = branches[i];
      ctx.save();
      ctx.beginPath();
      var pStart = getBranchPoint(br, 0);
      ctx.moveTo(pStart.x, pStart.y);
      for (var s = 1; s <= 28; s++) {
        var pt = getBranchPoint(br, s / 28);
        ctx.lineTo(pt.x, pt.y);
      }
      var pEnd = getBranchPoint(br, 1.0);
      var stemGrad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
      if (br.isTrunk) {
        stemGrad.addColorStop(0, 'rgba(18, 46, 138, 0.55)');
        stemGrad.addColorStop(1, 'rgba(59, 130, 246, 0.42)');
      } else {
        stemGrad.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
        stemGrad.addColorStop(1, 'rgba(16, 185, 129, 0.55)');
      }
      ctx.strokeStyle = stemGrad;
      ctx.lineWidth = br.lineWidth || 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // 绘制用户节点与根部
    drawRootNode(false);
    for (var b = 0; b < branches.length; b++) {
      if (branches[b].user) {
        drawUserLeafNode(branches[b], isEn);
      }
    }
  }

  // 绘制根部：创作者知识源核
  function drawRootNode(animateGuide) {
    var isEn = document.documentElement.lang === 'en-US';
    ctx.save();

    // 1. 柔和背部外光晕
    var rootGlow = ctx.createRadialGradient(root.x, root.y, 10, root.x, root.y, 68);
    rootGlow.addColorStop(0, 'rgba(18, 46, 138, 0.15)');
    rootGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = rootGlow;
    ctx.beginPath();
    ctx.arc(root.x, root.y, 68, 0, Math.PI * 2);
    ctx.fill();

    // 2. 细微天球引导环（与 Hero 同款 0.85px 发丝线）
    var rot = animateGuide ? clock * 0.08 : 0;
    ctx.beginPath();
    ctx.arc(root.x, root.y, 46, rot, rot + Math.PI * 2);
    ctx.strokeStyle = 'rgba(18, 46, 138, 0.22)';
    ctx.lineWidth = 0.85;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. 高透白磨砂微盘（r=30px）
    ctx.beginPath();
    ctx.arc(root.x, root.y, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(253, 251, 249, 0.96)';
    ctx.shadowColor = 'rgba(44, 40, 36, 0.08)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fill();

    // 边框（清除阴影以保证极细清晰度）
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(root.x, root.y, 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(18, 46, 138, 0.35)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 4. 盘心与链官方双环徽标
    drawUlinkIcon(ctx, root.x, root.y, 12);

    // 5. 创作者源标牌（下方）
    var rootPillW = isEn ? 126 : 116;
    var rootPillH = 24;
    var rpx = root.x - rootPillW * 0.5;
    var rpy = root.y + 40;

    drawRoundRect(ctx, rpx, rpy, rootPillW, rootPillH, 12);
    ctx.fillStyle = 'rgba(253, 251, 249, 0.96)';
    ctx.shadowColor = 'rgba(44, 40, 36, 0.05)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fill();

    // 清除阴影，画描边与文字
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    drawRoundRect(ctx, rpx, rpy, rootPillW, rootPillH, 12);
    ctx.strokeStyle = 'rgba(18, 46, 138, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#122E8A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isEn ? "Creator's Collection" : '创作者公开精选集', root.x, rpy + rootPillH * 0.5);

    // 顶部等宽标识（背景微描边镂空，防天球虚线穿刺）
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.strokeStyle = '#F5EFEA';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeText('ORIGIN ROOT // 8F2A', root.x, root.y - 42);
    ctx.fillStyle = 'rgba(106, 102, 96, 0.75)';
    ctx.fillText('ORIGIN ROOT // 8F2A', root.x, root.y - 42);

    ctx.restore();
  }

  // 绘制末梢用户微盘与悬挂名牌
  function drawUserLeafNode(bNode, isEn) {
    var tip = getBranchPoint(bNode, bNode.tGrowth);
    var scale = Math.min(1.0, bNode.tGrowth * 1.4);

    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.scale(scale, scale);

    // 用户磨砂微盘（r=17px）
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(253, 251, 249, 0.96)';
    ctx.shadowColor = 'rgba(44, 40, 36, 0.08)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fill();

    // 翡翠微光边框（清除阴影）
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.strokeStyle = bNode.user.isNew ? '#10B981' : 'rgba(16, 185, 129, 0.65)';
    ctx.lineWidth = bNode.user.isNew ? 1.8 : 1.2;
    ctx.stroke();

    // 用户发光叶核晶体
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = bNode.user.color;
    ctx.shadowColor = 'rgba(16, 185, 129, 0.5)';
    ctx.shadowBlur = 6;
    ctx.fill();

    // 悬挂药丸标牌（向右舒展）
    var roleText = isEn ? bNode.user.roleEn : bNode.user.roleZh;

    ctx.font = '600 9.8px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    var nameW = ctx.measureText(bNode.user.name).width;
    ctx.font = '500 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    var roleW = ctx.measureText(roleText).width;
    var uLabelW = Math.max(96, Math.ceil(nameW + roleW + 18));
    var uLabelH = 20;
    var lx = 22;
    var ly = -uLabelH * 0.5;

    drawRoundRect(ctx, lx, ly, uLabelW, uLabelH, 10);
    ctx.fillStyle = 'rgba(253, 251, 249, 0.95)';
    ctx.shadowColor = 'rgba(44, 40, 36, 0.05)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.fill();

    // 清除文字与边框阴影
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    drawRoundRect(ctx, lx, ly, uLabelW, uLabelH, 10);
    ctx.strokeStyle = bNode.user.isNew ? 'rgba(16, 185, 129, 0.6)' : 'rgba(229, 221, 211, 0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 9.8px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#2C2824';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(bNode.user.name, lx + 7, 0);

    ctx.font = '500 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#059669';
    ctx.textAlign = 'right';
    ctx.fillText(roleText, lx + uLabelW - 7, 0);

    ctx.restore();
  }

  function draw(now) {
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0.016;
    lastT = now;
    clock += dt;

    ctx.clearRect(0, 0, W, H);
    if (W <= 0 || H <= 0) return;

    var isEn = document.documentElement.lang === 'en-US';

    // ── 1. 绘制各条树枝（Stems） ──
    for (var i = 0; i < branches.length; i++) {
      var br = branches[i];
      if (br.tGrowth < 1.0) {
        br.tGrowth = Math.min(1.0, br.tGrowth + (br.growthSpeed || 0.02));
        if (br.tGrowth >= 1.0) {
          var tipPt = getBranchPoint(br, 1.0);
          ripples.push({
            x: tipPt.x, y: tipPt.y,
            r: 8, maxR: 44,
            alpha: 0.9, color: '16, 185, 129'
          });
        }
      }

      ctx.save();
      ctx.beginPath();
      var pStart = getBranchPoint(br, 0);
      ctx.moveTo(pStart.x, pStart.y);

      var steps = 28;
      var curSteps = Math.max(1, Math.round(steps * br.tGrowth));
      for (var s = 1; s <= curSteps; s++) {
        var pt = getBranchPoint(br, (s / steps) * br.tGrowth);
        ctx.lineTo(pt.x, pt.y);
      }

      var pEnd = getBranchPoint(br, 1.0);
      var stemGrad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
      if (br.isTrunk) {
        stemGrad.addColorStop(0, 'rgba(18, 46, 138, 0.55)');
        stemGrad.addColorStop(1, 'rgba(59, 130, 246, 0.42)');
      } else {
        stemGrad.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
        stemGrad.addColorStop(1, 'rgba(16, 185, 129, 0.55)');
      }

      ctx.strokeStyle = stemGrad;
      ctx.lineWidth = br.lineWidth || 1.6;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 树枝微光发丝
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();
    }

    // ── 2. 输送树液光子（Sap Flow Photons） ──
    for (var p = 0; p < sapPhotons.length; p++) {
      var sp = sapPhotons[p];
      var targetBr = branches[sp.branchIdx % branches.length];
      if (!targetBr) continue;

      sp.t += sp.speed;
      if (sp.t > targetBr.tGrowth) {
        sp.t = 0;
        sp.branchIdx = Math.floor(Math.random() * branches.length);
      }

      var sPt = getBranchPoint(targetBr, sp.t);
      var sPrevPt = getBranchPoint(targetBr, Math.max(0, sp.t - 0.055));

      ctx.save();
      var pGrad = ctx.createLinearGradient(sPrevPt.x, sPrevPt.y, sPt.x, sPt.y);
      pGrad.addColorStop(0, 'rgba(59, 130, 246, 0)');
      pGrad.addColorStop(1, 'rgba(16, 185, 129, 0.85)');

      ctx.beginPath();
      ctx.moveTo(sPrevPt.x, sPrevPt.y);
      ctx.lineTo(sPt.x, sPt.y);
      ctx.strokeStyle = pGrad;
      ctx.lineWidth = sp.size * 0.9;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sPt.x, sPt.y, sp.size * 0.65, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#10B981';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }

    // ── 3. 绘制各分支末梢的用户微晶节点 ──
    for (var b = 0; b < branches.length; b++) {
      var bNode = branches[b];
      if (!bNode.user || bNode.tGrowth < 0.25) continue;
      drawUserLeafNode(bNode, isEn);
    }

    // ── 4. 绘制根部：创作者公开知识源核 ──
    drawRootNode(true);

    // ── 5. 渲染扩散涟漪 ──
    for (var rp = ripples.length - 1; rp >= 0; rp--) {
      var rip = ripples[rp];
      rip.r += 1.5;
      rip.alpha -= 0.018;
      if (rip.alpha <= 0 || rip.r >= rip.maxR) {
        ripples.splice(rp, 1);
        continue;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + rip.color + ', ' + Math.max(0, rip.alpha) + ')';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    }

    // ── 6. 底部等宽微提示 ──
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(245, 239, 234, 0.9)';
    ctx.lineWidth = 3;
    var hintText = isEn
      ? 'CLICK ANYWHERE TO SPROUT YOUR BRANCH & FORK REPLICA'
      : '点击右侧舞台任意处 · 顺势生长出属于你的用户分支与 Fork 副本';
    ctx.strokeText(hintText, W * 0.5, H * 0.94);
    ctx.fillStyle = 'rgba(106, 102, 96, 0.7)';
    ctx.fillText(hintText, W * 0.5, H * 0.94);
    ctx.restore();
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    rafId = requestAnimationFrame(loop);
  }

  function play() {
    if (running || reducedMotion) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function start() {
    resize();
    if (reducedMotion) return;

    var host = canvas.closest('.sect') || wrapper;
    if (host) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
      host.addEventListener('click', function (e) {
        var rect = canvas.getBoundingClientRect();
        spawnUserBranch(e.clientX - rect.left, e.clientY - rect.top);
      });
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
