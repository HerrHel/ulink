/*
 * 与链 ulink — 多端同频与端到端加密视觉（/ 首页专用，Canvas 2D，零依赖）
 *
 * 【自主精修版 · 空间比例优化 + 明确因果关系 + 真实光学透镜效果】
 *
 * 1. 【宏观网络（上半部）】：
 *    - 💻 本机设备·权威库（iMac，IndexedDB）↔ 蓝色流光 ↔ 🔐 云端加密锁 ↔ 绿色流光 ↔ 📱 移动端·实时同频（iPhone，PWA）
 *    - 锁体带有同心光晕与「● AES-256-GCM 密文」顶标，居中统领全局。
 *
 * 2. 【因果关系管道（中轴承接）】：
 *    - 从中央云端锁底垂直垂落一道微光数据流管道，伴随脉冲粒子直接汇入下方的书签卡片；
 *    - 明确表达：下方卡片正是三端在云端锁保护下实时同步的真实载荷（Payload）。
 *
 * 3. 【舒适比例书签卡片（下半部）】：
 *    - 黄金长宽比（约 2.4 : 1），呼吸感强，内外边距从容大方；
 *    - 正常展示「与链 ulink」、域名、属性标签与子站入口；
 *    - 核心凭据栏默认显示十六进制 AES-256 物理密文（0x7F4A... / 0xD21F...），体现云端存储零知识。
 *
 * 4. 【逼真光学透镜效果（动态交互）】：
 *    - 纯圆镜圈，无多余手柄，镜圈具备：双层钛金镜框 + 菲涅尔纯白月牙高光 + 精密中心光学十字准星 + 微色散镀膜边缘；
 *    - 【真实凸透光学微放大】：透过透镜观察时，内部内容产生 1.055x 真实凸透镜光学放大效果；
 *    - 【即时解密】：在透镜视界内，密文瞬间还原为明文账号（admin@ulink.ren）与密码（••••••••）；
 *    - 【自动平滑显隐】：鼠标离开卡片范围时，透镜平滑淡出并完全隐藏，卡片恢复洁净密文呈现。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('sync-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var wrapper = canvas.parentElement;
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, DPR = 1;
  var pointer = { x: -1000, y: -1000, tx: -1000, ty: -1000, active: false, inCard: false };
  var lensAlpha = 0; // 0 = 隐藏，1 = 完全显现
  var lastT = 0, rafId = 0, running = false, inView = true;

  // 16 进制原始字符池与稠密瀑布流矩阵
  var HEX_CHARS = '0123456789ABCDEF';
  var NUM_COLS = 12;
  var NUM_ROWS_RIBBON = 24;
  var COL_RIBBONS = [];
  var COL_HIGHLIGHT = [];
  var COL_SPEEDS = [1.15, 1.45, 0.9, 1.3, 1.6, 1.0, 1.25, 1.5, 0.85, 1.35, 1.1, 1.4];
  var lastMutateT = 0;

  function initCipherRibbons() {
    COL_RIBBONS = [];
    COL_HIGHLIGHT = [];
    for (var c = 0; c < NUM_COLS; c++) {
      var col = [];
      var hlCol = [];
      for (var r = 0; r < NUM_ROWS_RIBBON; r++) {
        var h1 = HEX_CHARS[Math.floor(Math.random() * 16)];
        var h2 = HEX_CHARS[Math.floor(Math.random() * 16)];
        col.push(h1 + h2);

        // 将颜色永久绑定至槽位：跟随下泄流速丝滑匀速滑动，杜绝任何阶跃与回跳
        var seed = (c * 7 + r * 13) % 17;
        if (seed === 0 || seed === 5) {
          hlCol.push(2); // 翠绿光子 (Emerald)
        } else if (seed === 3 || seed === 9) {
          hlCol.push(1); // 科技湛蓝 (Navy)
        } else {
          hlCol.push(0); // 经典基准灰 (Slate)
        }
      }
      COL_RIBBONS.push(col);
      COL_HIGHLIGHT.push(hlCol);
    }
  }
  initCipherRibbons();

  function mutateCipher(t) {
    if (t - lastMutateT < 0.35) return;
    lastMutateT = t;
    // 每次随机只突变 1~2 个字符的数值内容，位置与色彩绝对平滑稳定
    for (var k = 0; k < 2; k++) {
      var c = Math.floor(Math.random() * NUM_COLS);
      var r = Math.floor(Math.random() * NUM_ROWS_RIBBON);
      COL_RIBBONS[c][r] = HEX_CHARS[Math.floor(Math.random() * 16)] + HEX_CHARS[Math.floor(Math.random() * 16)];
    }
  }

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

  // 渲染底层瀑布流密文卡片（默认状态：纯密文瀑布，无账号密码框）
  function renderCipherWaterfall(c, cardX, cardY, cardW, cardH, sc, t) {
    c.save();
    // 底层卡片容器
    c.shadowColor = 'rgba(28, 24, 20, 0.06)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 4;
    c.fillStyle = '#FAF7F2';
    c.beginPath();
    drawRoundRect(c, cardX, cardY, cardW, cardH, 14);
    c.fill();
    c.shadowColor = 'transparent';

    c.strokeStyle = '#E5DDD3';
    c.lineWidth = 1.2;
    c.stroke();

    // 限制在卡片内部裁切
    c.beginPath();
    drawRoundRect(c, cardX, cardY, cardW, cardH, 14);
    c.clip();

    // 瀑布流密文字符阵列
    var padX = Math.round(16 * sc);
    var padY = Math.round(14 * sc);
    var usableW = cardW - padX * 2;
    var colW = usableW / NUM_COLS;
    var rowH = Math.round(15 * sc);
    var totalLoopH = NUM_ROWS_RIBBON * rowH;

    c.font = '600 ' + Math.round(11 * sc) + 'px "JetBrains Mono", Consolas, monospace';
    c.textAlign = 'center';

    for (var ci = 0; ci < NUM_COLS; ci++) {
      var colX = cardX + padX + ci * colW + colW / 2;
      var spd = COL_SPEEDS[ci % COL_SPEEDS.length];
      var colDist = (t * 24 * spd) % totalLoopH;

      for (var ri = 0; ri < NUM_ROWS_RIBBON; ri++) {
        var relY = (ri * rowH + colDist) % totalLoopH;
        var charY = cardY + padY + relY - Math.round(14 * sc);
        if (charY < cardY - 5 || charY > cardY + cardH + 10) continue;

        var byteStr = COL_RIBBONS[ci][ri];
        var hl = COL_HIGHLIGHT[ci][ri];

        // 颜色与字符位置 100% 物理绑定，跟随瀑布丝滑下泄，绝不回跳
        if (hl === 2) {
          c.fillStyle = '#10B981'; // 纯正翠绿高亮
        } else if (hl === 1) {
          c.fillStyle = 'rgba(18, 46, 138, 0.78)'; // 科技湛蓝
        } else {
          c.fillStyle = 'rgba(75, 85, 99, 0.58)'; // 基准灰
        }

        c.fillText(byteStr, colX, charY);
      }
    }

    // 顶部与底部边缘羽化微渐变
    var topGrad = c.createLinearGradient(0, cardY, 0, cardY + Math.round(20 * sc));
    topGrad.addColorStop(0, 'rgba(250, 247, 242, 0.95)');
    topGrad.addColorStop(1, 'rgba(250, 247, 242, 0)');
    c.fillStyle = topGrad;
    c.fillRect(cardX, cardY, cardW, Math.round(20 * sc));

    var btmGrad = c.createLinearGradient(0, cardY + cardH - Math.round(20 * sc), 0, cardY + cardH);
    btmGrad.addColorStop(0, 'rgba(250, 247, 242, 0)');
    btmGrad.addColorStop(1, 'rgba(250, 247, 242, 0.95)');
    c.fillStyle = btmGrad;
    c.fillRect(cardX, cardY + cardH - Math.round(20 * sc), cardW, Math.round(20 * sc));

    c.restore();
  }

  // 渲染圆圈透镜内部解密后的卡片与美化账号密码框（基于主站结构，无复制/眼睛按钮，密码为 ulink123）
  function renderDecryptedBoxes(c, cardX, cardY, cardW, cardH, sc, isEn) {
    c.save();

    // ── 1. 卡片高光底板 ──
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    drawRoundRect(c, cardX, cardY, cardW, cardH, 14);
    c.fill();

    c.strokeStyle = '#E5DDD3'; // var(--border)
    c.lineWidth = 1.3;
    c.stroke();

    // 约束在卡片圆角内裁切
    c.beginPath();
    drawRoundRect(c, cardX, cardY, cardW, cardH, 14);
    c.clip();

    var padX = Math.round(16 * sc);
    var padY = Math.round(13 * sc);

    // ── 2. 账号密码折叠头 (.card-acct-toggle) ──
    var toggleY = cardY + padY;
    var toggleX = cardX + padX;
    var chCenterY = toggleY + Math.round(7 * sc);

    // 下箭头 ChevronDown: <polyline points="6 9 12 15 18 9"/>
    c.strokeStyle = '#6A6660'; // var(--text-muted)
    c.lineWidth = 1.8;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(toggleX + 2, chCenterY - Math.round(2.5 * sc));
    c.lineTo(toggleX + Math.round(5.5 * sc), chCenterY + Math.round(2 * sc));
    c.lineTo(toggleX + Math.round(9 * sc), chCenterY - Math.round(2.5 * sc));
    c.stroke();

    // 「账户信息」/「Account info」
    c.fillStyle = '#6A6660'; // var(--text-muted)
    c.font = '600 ' + Math.round(11.5 * sc) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(isEn ? 'Account info' : '账户信息', toggleX + Math.round(14 * sc), chCenterY);

    // ── 3. 展开抽屉面板 (.card-acct-body) ──
    var bodyX = cardX + padX;
    var bodyY = toggleY + Math.round(18 * sc);
    var bodyW = cardW - padX * 2;
    var bodyH = Math.round(108 * sc);
    var bodyR = Math.round(9 * sc);

    c.fillStyle = '#F7F2EC'; // var(--surface-hover)
    c.beginPath();
    drawRoundRect(c, bodyX, bodyY, bodyW, bodyH, bodyR);
    c.fill();

    c.strokeStyle = '#EFE8DF'; // var(--border-light)
    c.lineWidth = 1;
    c.stroke();

    // ── 4. 美化账号槽框与密码槽框 ──
    var slotMarginX = Math.round(8 * sc);
    var slotMarginY = Math.round(8 * sc);
    var slotX = bodyX + slotMarginX;
    var slotW = bodyW - slotMarginX * 2;
    var slotH = Math.round(41 * sc);
    var slotR = Math.round(6 * sc);

    var slot1Y = bodyY + slotMarginY;
    var slot2Y = slot1Y + slotH + Math.round(8 * sc);

    var labelPadX = Math.round(12 * sc);
    var valPadX = slotX + Math.round((isEn ? 70 : 50) * sc);

    // ── 4.1 账号框 ──
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    drawRoundRect(c, slotX, slot1Y, slotW, slotH, slotR);
    c.fill();

    c.strokeStyle = '#E2D9CE';
    c.lineWidth = 1;
    c.stroke();

    // 账户标签
    c.fillStyle = '#6A6660'; // var(--text-muted)
    c.font = '500 ' + Math.round(11.5 * sc) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(isEn ? 'Account' : '账户', slotX + labelPadX, slot1Y + slotH / 2);

    // 竖直微分割装饰点
    c.fillStyle = '#DDD5CB';
    c.beginPath();
    c.arc(slotX + Math.round((isEn ? 58 : 40) * sc), slot1Y + slotH / 2, 1.2, 0, Math.PI * 2);
    c.fill();

    // 账户值
    c.fillStyle = '#2C2824'; // var(--text)
    c.font = '600 ' + Math.round(12.5 * sc) + 'px "JetBrains Mono", Consolas, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('admin@ulink.ren', valPadX, slot1Y + slotH / 2);

    // ── 4.2 密码框 ──
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    drawRoundRect(c, slotX, slot2Y, slotW, slotH, slotR);
    c.fill();

    c.strokeStyle = '#E2D9CE';
    c.lineWidth = 1;
    c.stroke();

    // 密码标签
    c.fillStyle = '#6A6660'; // var(--text-muted)
    c.font = '500 ' + Math.round(11.5 * sc) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(isEn ? 'Password' : '密码', slotX + labelPadX, slot2Y + slotH / 2);

    // 竖直微分割装饰点
    c.fillStyle = '#DDD5CB';
    c.beginPath();
    c.arc(slotX + Math.round((isEn ? 58 : 40) * sc), slot2Y + slotH / 2, 1.2, 0, Math.PI * 2);
    c.fill();

    // 密码值：ulink123
    c.fillStyle = '#2C2824'; // var(--text)
    c.font = '600 ' + Math.round(12.5 * sc) + 'px "JetBrains Mono", Consolas, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('ulink123', valPadX, slot2Y + slotH / 2);

    c.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    if (W <= 0 || H <= 0) return;

    var isEn = document.documentElement.lang === 'en-US';
    var sc = Math.max(0.88, Math.min(1.30, Math.min(W, H) / 380));
    var cx = W / 2;

    mutateCipher(t);

    // ════════════════════════════════════════════════════════════
    // ── 1. 上半部分：宏观三端网络 (Desktop ↔ Lock ↔ Mobile) ──
    // ════════════════════════════════════════════════════════════
    var totalVisualH = Math.round(265 * sc);
    var startTop = Math.max(Math.round(10 * sc), Math.round((H - totalVisualH) / 2));

    var lockX = cx;
    var lockY = startTop + Math.round(46 * sc);
    var pcX = cx - Math.round(150 * sc);
    var phoneX = cx + Math.round(150 * sc);

    // ── 1.1 背景虚线圆弧同心轨道 ──
    ctx.save();
    ctx.strokeStyle = 'rgba(18, 46, 138, 0.07)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(lockX, lockY, Math.round(84 * sc), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── 1.2 双向流动导轨 (左蓝流光，右绿流光) ──
    ctx.save();
    var dashOffset = (t * 22) % 16;
    var leftCp1Y = lockY - Math.round(10 * sc);
    var leftCp2Y = lockY + Math.round(10 * sc);

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -dashOffset;
    ctx.beginPath();
    ctx.moveTo(pcX + Math.round(46 * sc), lockY - Math.round(6 * sc));
    ctx.quadraticCurveTo(cx - Math.round(76 * sc), leftCp1Y, lockX - Math.round(44 * sc), lockY - Math.round(6 * sc));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pcX + Math.round(46 * sc), lockY + Math.round(6 * sc));
    ctx.quadraticCurveTo(cx - Math.round(76 * sc), leftCp2Y, lockX - Math.round(44 * sc), lockY + Math.round(6 * sc));
    ctx.stroke();

    var rightCp1Y = lockY - Math.round(10 * sc);
    var rightCp2Y = lockY + Math.round(10 * sc);

    ctx.strokeStyle = '#10B981';
    ctx.lineDashOffset = dashOffset;
    ctx.beginPath();
    ctx.moveTo(lockX + Math.round(44 * sc), lockY - Math.round(6 * sc));
    ctx.quadraticCurveTo(cx + Math.round(76 * sc), rightCp1Y, phoneX - Math.round(23 * sc), lockY - Math.round(6 * sc));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(lockX + Math.round(44 * sc), lockY + Math.round(6 * sc));
    ctx.quadraticCurveTo(cx + Math.round(76 * sc), rightCp2Y, phoneX - Math.round(23 * sc), lockY + Math.round(6 * sc));
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();

    // ── 1.3 左侧：💻 本机设备 · 权威库（图标放大） ──
    ctx.save();
    var pcW = Math.round(92 * sc);
    var pcH = Math.round(62 * sc);
    var pcTop = lockY - pcH / 2 - Math.round(3 * sc);

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(28, 24, 20, 0.08)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    drawRoundRect(ctx, pcX - pcW / 2, pcTop, pcW, pcH, 6);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = '#DDD5CB';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 摄像头微孔
    ctx.fillStyle = '#10B981';
    ctx.beginPath();
    ctx.arc(pcX, pcTop + Math.round(3.5 * sc), 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 屏幕内微缩 UI
    var scrX = pcX - pcW / 2 + Math.round(4 * sc);
    var scrY = pcTop + Math.round(6 * sc);
    var scrW = pcW - Math.round(8 * sc);
    var scrH = pcH - Math.round(12 * sc);

    ctx.fillStyle = '#FAF8F5';
    ctx.beginPath();
    drawRoundRect(ctx, scrX, scrY, scrW, scrH, 3);
    ctx.fill();

    // 侧栏
    ctx.fillStyle = '#122E8A';
    ctx.beginPath();
    drawRoundRect(ctx, scrX + 3, scrY + 5, 12, 3.5, 1);
    ctx.fill();
    ctx.fillStyle = '#D6CEC3';
    ctx.beginPath();
    drawRoundRect(ctx, scrX + 3, scrY + 12, 10, 2.5, 1);
    drawRoundRect(ctx, scrX + 3, scrY + 17, 8, 2.5, 1);
    drawRoundRect(ctx, scrX + 3, scrY + 22, 9, 2.5, 1);
    ctx.fill();

    // 屏幕右侧微卡片
    var mcX = scrX + 19;
    var mcW = scrW - 23;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    drawRoundRect(ctx, mcX, scrY + 5, mcW, 15, 2.5);
    ctx.fill();
    ctx.strokeStyle = '#EFE8DF';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#122E8A';
    ctx.fillRect(mcX + 3, scrY + 7, 5, 5);
    ctx.fillStyle = '#3C3834';
    ctx.fillRect(mcX + 11, scrY + 7, mcW - 15, 2.2);
    ctx.fillStyle = '#B0A89E';
    ctx.fillRect(mcX + 11, scrY + 11, mcW - 22, 1.6);

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    drawRoundRect(ctx, mcX, scrY + 23, mcW, 15, 2.5);
    ctx.fill();
    ctx.strokeStyle = '#EFE8DF';
    ctx.stroke();
    ctx.fillStyle = '#10B981';
    ctx.fillRect(mcX + 3, scrY + 25, 5, 5);
    ctx.fillStyle = '#3C3834';
    ctx.fillRect(mcX + 11, scrY + 25, mcW - 15, 2.2);
    ctx.fillStyle = '#B0A89E';
    ctx.fillRect(mcX + 11, scrY + 29, mcW - 22, 1.6);

    // 立柱与底座
    ctx.strokeStyle = '#DDD5CB';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pcX, pcTop + pcH);
    ctx.lineTo(pcX, pcTop + pcH + Math.round(9 * sc));
    ctx.moveTo(pcX - Math.round(18 * sc), pcTop + pcH + Math.round(9 * sc));
    ctx.lineTo(pcX + Math.round(18 * sc), pcTop + pcH + Math.round(9 * sc));
    ctx.stroke();

    ctx.restore();

    // ── 1.4 右侧：📱 移动端 · 实时同频（图标放大） ──
    ctx.save();
    var phW = Math.round(46 * sc);
    var phH = Math.round(78 * sc);
    var phTop = lockY - phH / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(28, 24, 20, 0.08)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    drawRoundRect(ctx, phoneX - phW / 2, phTop, phW, phH, 9);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.strokeStyle = '#DDD5CB';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 听筒微条
    ctx.fillStyle = '#C4BCB1';
    ctx.beginPath();
    drawRoundRect(ctx, phoneX - 6, phTop + 4.5, 12, 1.8, 1);
    ctx.fill();

    var pscrX = phoneX - phW / 2 + Math.round(4 * sc);
    var pscrY = phTop + Math.round(9 * sc);
    var pscrW = phW - Math.round(8 * sc);
    var pscrH = phH - Math.round(17 * sc);

    ctx.fillStyle = '#FAF8F5';
    ctx.beginPath();
    drawRoundRect(ctx, pscrX, pscrY, pscrW, pscrH, 4);
    ctx.fill();

    var colors = ['#122E8A', '#10B981', '#F59E0B'];
    for (var mi = 0; mi < 3; mi++) {
      var rowY = pscrY + 5 + mi * 15;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      drawRoundRect(ctx, pscrX + 2.5, rowY, pscrW - 5, 12, 2.5);
      ctx.fill();
      ctx.strokeStyle = '#EFE8DF';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.fillStyle = colors[mi];
      ctx.fillRect(pscrX + 4.5, rowY + 3.5, 4.5, 4.5);
      ctx.fillStyle = '#3C3834';
      ctx.fillRect(pscrX + 11.5, rowY + 3.5, pscrW - 17, 1.8);
      ctx.fillStyle = '#B0A89E';
      ctx.fillRect(pscrX + 11.5, rowY + 7, pscrW - 23, 1.3);
    }

    // 底部 Home 指示条
    ctx.fillStyle = '#C4BCB1';
    ctx.beginPath();
    drawRoundRect(ctx, phoneX - 7, phTop + phH - 5.5, 14, 2, 1);
    ctx.fill();
    ctx.restore();

    // ── 1.5 中央：🔐 云端加密锁（绝对几何与光学圆心对齐） ──
    ctx.save();
    var halo1R = Math.round(42 * sc);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.arc(lockX, lockY, halo1R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#EBE3D7';
    ctx.lineWidth = 1;
    ctx.stroke();

    var halo2R = Math.round(34 * sc);
    ctx.fillStyle = '#EDF3FA';
    ctx.beginPath();
    ctx.arc(lockX, lockY, halo2R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#D4E3F3';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = '#122E8A';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 锁环（高度与锁身对称，顶部至 lockY - 16*sc）
    var skR = Math.round(9.5 * sc);
    var skY = lockY - Math.round(6.5 * sc);
    ctx.beginPath();
    ctx.arc(lockX, skY, skR, Math.PI, 0);
    ctx.lineTo(lockX + skR, skY + Math.round(6 * sc));
    ctx.moveTo(lockX - skR, skY);
    ctx.lineTo(lockX - skR, skY + Math.round(6 * sc));
    ctx.stroke();

    // 锁身（底部至 lockY + 16*sc，全锁严格以 lockY 为圆心中心）
    var lBodyW = Math.round(26 * sc);
    var lBodyH = Math.round(19 * sc);
    var lBodyY = lockY - Math.round(3 * sc);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    drawRoundRect(ctx, lockX - lBodyW / 2, lBodyY, lBodyW, lBodyH, 4);
    ctx.fill();
    ctx.stroke();

    // 锁孔中心
    var keyholeY = lBodyY + lBodyH / 2;
    ctx.fillStyle = '#122E8A';
    ctx.beginPath();
    ctx.arc(lockX, keyholeY - 1, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lockX - 1.1, keyholeY);
    ctx.lineTo(lockX + 1.1, keyholeY);
    ctx.lineTo(lockX + 0.8, keyholeY + 4.5);
    ctx.lineTo(lockX - 0.8, keyholeY + 4.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // ════════════════════════════════════════════════════════════
    // ── 2. 中轴流光连接束 (Lock to Cipher Waterfall) ──
    // ════════════════════════════════════════════════════════════
    var cardTopY = lockY + Math.round(52 * sc);
    var cardW = Math.min(W - 32, Math.round(350 * sc));
    var cardH = Math.round(170 * sc);
    var cardX = cx - cardW / 2;

    ctx.save();
    // 细致垂直光束线
    ctx.strokeStyle = '#D5CBBE';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, lockY + Math.round(16 * sc));
    ctx.lineTo(cx, cardTopY);
    ctx.stroke();

    // 下坠光脉冲粒子
    var downP = (t * 1.5) % 1;
    var downY = (lockY + Math.round(16 * sc)) + (cardTopY - (lockY + Math.round(16 * sc))) * downP;
    ctx.fillStyle = '#10B981';
    ctx.beginPath();
    ctx.arc(cx, downY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ════════════════════════════════════════════════════════════
    // ── 3. 下半部分：瀑布密文与交互更新 ──
    // ════════════════════════════════════════════════════════════
    if (pointer.active) {
      if (pointer.x < -500) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      } else {
        pointer.x += (pointer.tx - pointer.x) * 0.22;
        pointer.y += (pointer.ty - pointer.y) * 0.22;
      }
    }

    pointer.inCard = (pointer.active &&
                      pointer.tx >= cardX - 12 && pointer.tx <= cardX + cardW + 12 &&
                      pointer.ty >= cardTopY - 12 && pointer.ty <= cardTopY + cardH + 12);

    var targetAlpha = pointer.inCard ? 1 : 0;
    lensAlpha += (targetAlpha - lensAlpha) * 0.18;

    // 渲染底层瀑布流密文（纯密文，绝无账号密码框）
    renderCipherWaterfall(ctx, cardX, cardTopY, cardW, cardH, sc, t);

    // ════════════════════════════════════════════════════════════
    // ── 4. 真实光学透镜效果（圆圈解密后才会出现账号密码框及其内容）──
    // ════════════════════════════════════════════════════════════
    if (lensAlpha > 0.005) {
      ctx.save();
      ctx.globalAlpha = lensAlpha;

      var lx = pointer.x;
      var ly = pointer.y;
      var lr = Math.round(58 * sc); // 光学透镜视野半径（更沉浸饱满）

      // ── 4.1 光学凸透镜视野遮罩与解密 ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.clip(); // 建立透镜内部视界

      // 【物理光学凸透放大】：以透镜中心为原点，产生 1.055x 的微放大真实景深
      ctx.save();
      ctx.translate(lx, ly);
      ctx.scale(1.055, 1.055);
      ctx.translate(-lx, -ly);

      // 在透镜视界中首次显现解密后的账号密码框及其内容！
      renderDecryptedBoxes(ctx, cardX, cardTopY, cardW, cardH, sc, isEn);
      ctx.restore();

      // 镜片中心轻微光学十字准星标尺
      ctx.strokeStyle = 'rgba(18, 46, 138, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx - 9, ly); ctx.lineTo(lx - 3, ly);
      ctx.moveTo(lx + 3, ly); ctx.lineTo(lx + 9, ly);
      ctx.moveTo(lx, ly - 9); ctx.lineTo(lx, ly - 3);
      ctx.moveTo(lx, ly + 3); ctx.lineTo(lx, ly + 9);
      ctx.stroke();

      ctx.restore(); // 结束透镜遮罩

      // ── 4.2 光学镜片玻璃框体质感 (Glass Rim & Refraction) ──
      // 物理柔和深空投影
      ctx.shadowColor = 'rgba(20, 16, 12, 0.22)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 7;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowColor = 'transparent';

      // 钛金金属精密双圈
      ctx.strokeStyle = '#D5CBBE';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.stroke();

      // 微色散光学镀膜反光外圈 (Chromatic dispersion fringe hint)
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(lx, ly, lr + 0.8, Math.PI * 0.2, Math.PI * 0.7);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(79, 124, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(lx, ly, lr + 0.8, Math.PI * 1.2, Math.PI * 1.7);
      ctx.stroke();

      // 纯白菲涅尔月牙高光反光弧 (Fresnel Specular Arc)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(lx, ly, lr - 2, Math.PI * 1.15, Math.PI * 1.65);
      ctx.stroke();

      ctx.restore();
    }
  }

  function frame(ts) {
    if (!running) return;
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
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    pointer.tx = e.clientX - rect.left;
    pointer.ty = e.clientY - rect.top;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
  }

  function start() {
    resize();
    if (reducedMotion) return;

    var host = canvas.closest('.sect') || wrapper;
    if (host) {
      host.addEventListener('pointermove', onPointerMove, { passive: true });
      host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    }
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });

    window.addEventListener('pointermove', function (e) {
      if (!canvas) return;
      var rect = canvas.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        pointer.tx = e.clientX - rect.left;
        pointer.ty = e.clientY - rect.top;
        pointer.active = true;
      } else if (pointer.active && (e.clientX < rect.left - 40 || e.clientX > rect.right + 40 || e.clientY < rect.top - 40 || e.clientY > rect.bottom + 40)) {
        pointer.active = false;
      }
    }, { passive: true });

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
