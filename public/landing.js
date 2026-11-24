/*
 * 与链 ulink — 宣传页脚本（/about 专用，无框架零依赖）
 *
 * 2026-11-25 改版：画面改为真实应用截图（scripts/capture-landing.mjs 生成，中英各一套），
 * 手绘 canvas（hero/manage/sync/share-visual.js）与主题演示舞台全部移除。
 *
 * 职责（与 app 内代码零耦合，键名与 src/i18n 保持一致）：
 *  1. 备案号兜底渲染；
 *  2. 双语 —— 中文是 HTML 静态默认（SEO 与全站惯例一致）；切到英文由本脚本按
 *     ?lang= → lv_locale → navigator.language（与 /s/* 的 resolveLocale 顺序一致）即时替换：
 *       data-i18n       → textContent
 *       data-i18n-html  → innerHTML（词典是本文件内的常量，含 <br>/<kbd>/<a> 等少量标记）
 *       data-i18n-aria  → aria-label
 *       data-i18n-alt   → alt
 *       data-src-en     → 换成英文界面截图（data-size-en 给出与中文版不同的宽高）
 *     切回中文整页 reload 到静态原文；
 *  3. 页面增强 —— 顶栏吸顶分隔线、入场淡入、贯穿全页的「结」线（随滚动描出）。
 */

/* ────────────────────────────────────────────────────────────
 * 备案信息（合规要求，改动请与 src/config/site.ts 保持一致）
 *
 * · ICP 备案号：必须展示并链接工信部 <https://beian.miit.gov.cn/>
 * · 公安联网备案号：ICP 备案通过后 30 日内向属地公安网安办理，
 *   审核通过后由平台下发「备案号 + 网站标识码」，必须展示并链接公安平台
 *
 * ⚠️ 号为空即不渲染。绝不展示占位符——错误的备案号比不展示更容易被认定未履行义务。
 * ──────────────────────────────────────────────────────────── */
var ICP_NUMBER = '鄂ICP备2026061718号-1'  // 工信部 ICP 备案号
var MPS_NUMBER = ''  // 例：'鄂公网安备42011302000000号'
var MPS_CODE = ''    // 公安平台下发的网站标识码（用于定位查询链接）

;(function renderBeian(){
  try {
    var host = document.getElementById('foot-beian')
    if (!host) return
    var parts = []
    // ICP 号已在 about.html 里静态写死（不依赖 JS，便于核查工具抓取）。
    // 此处仅做兜底：若静态标记被误删，补回一个；已有则跳过，避免重复。
    if (ICP_NUMBER && host.textContent.indexOf(ICP_NUMBER) === -1) {
      host.insertAdjacentHTML(
        'beforeend',
        '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">' + ICP_NUMBER + '</a>'
      )
    }
    if (MPS_NUMBER) {
      var href = MPS_CODE
        ? 'https://beian.mps.gov.cn/#/query/webSearch?code=' + encodeURIComponent(MPS_CODE)
        : 'https://beian.mps.gov.cn/'
      parts.push(
        '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' +
          MPS_NUMBER +
        '</a>'
      )
    }
    if (parts.length) host.insertAdjacentHTML('beforeend', parts.join(''))
  } catch (e) { /* 备案号渲染失败不影响落地页其它功能 */ }
})();


(function () {
  'use strict';

  var LOCALE_KEY = 'lv_locale';            // 与 src/i18n/index.ts 的 LOCALE_KEY 一致

  /* ── 双语 ── */
  // 英文字典（中文是 HTML 内的静态默认，无需字典）。标点一律用 ASCII 直引号/撇号：标题宋体是中文字体，
  // 弯引号与撇号在其中是全角字形，会在英文里留出大空隙。合规口径与中文一致：
  // 加密只说「仅账号字段」，价格与额度不写数字，AI 标明为 PRO 能力。
  var EN = {
    'skip': 'Skip to content',
    'brand.aria': 'ulink',
    'brand.name': 'ulink',
    'nav.aria': 'Page sections',
    'nav.collect': 'Collect',
    'nav.organize': 'Organize',
    'nav.use': 'Use',
    'nav.pricing': 'Pricing',
    'lang.aria': 'Switch to Chinese',
    'head.login': 'Sign in',
    'head.start': 'Get started',

    'hero.kicker1': 'ulink',
    'hero.kicker2': 'Bookmarks × Notes × AI',
    'hero.title': 'Turn scattered links<br>into <span class="mark">your own</span> knowledge.',
    'hero.lede': 'Save a page and jot down why you saved it; let AI fill in the name and category. Opens instantly — no sign-up needed.',
    'cta.start': 'Get started',
    'cta.how': 'See how saving works',
    'promises.aria': 'Promises',
    'promises.free': 'Free to start',
    'promises.renew': 'No auto-renewal',
    'promises.export': 'Full data export',
    'alt.heroApp': 'The ulink app: categories on the left, a grid of bookmark cards on the right, the first one a Getting Started note',
    'alt.heroMobile': 'ulink on a phone: a list of bookmark cards',
    'cap.hero': 'What a new user sees on first open · real screenshot, not a mock-up',

    'no.collect': 'Collect',
    'collect.title': 'Paste the URL.<br>It handles the rest.',
    'collect.s1t': 'Save in a keystroke',
    'collect.s1d': 'Press <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>S</kbd> in the browser extension, or <kbd>Ctrl</kbd> <kbd>N</kbd> in the app.',
    'collect.s2t': 'Just the URL',
    'collect.s2d': 'Every other field can stay empty.',
    'collect.s3t': 'Filled in for you',
    'collect.s3d': 'Site name and category are detected automatically; change them if you like.',
    'collect.fine': 'AI autofill is a PRO feature, with a free trial.',
    'alt.collect': 'New bookmark dialog: only the URL https://www.figma.com was typed; the site name and category are already filled in',
    'collect.noteName': 'Name detected',
    'collect.noteCat': 'Category filed',
    'cap.collect': 'The real New bookmark dialog · only one URL typed',

    'no.organize': 'Organize',
    'organize.title': 'A link isn\'t just a URL.<br>It\'s a card with context.',
    'alt.note': 'Full-screen note: a rich-text Getting Started guide with GitHub and I Love PDF bookmark cards embedded at the end',
    'organize.tagNote': 'Bookmarks inside notes',
    'cap.note': 'Full-screen note · type @ to find and embed a bookmark',
    'alt.sub': 'A DeepSeek bookmark card with two sub-bookmarks underneath',
    'organize.tagSub': 'One site, many entries',
    'cap.sub': 'Sub-bookmarks · nest entry points under a site',
    'organize.f1t': 'Nested sub-bookmarks',
    'organize.f1d': 'Docs, console and repo, all kept under one site.',
    'organize.f2t': 'Notes with embeds',
    'organize.f2d': 'Write why you saved it and how to use it; embed bookmarks right in the text.',
    'organize.f3t': 'Attribute filters',
    'organize.f3d': 'Combine custom attributes to find anything in a large library.',

    'alt.chat': 'AI chat panel: asked for free online drawing tools, the answer offers Excalidraw, tldraw and Figma as candidate cards; the first is already saved',
    'cap.chat': 'Real interface · scripted demo answer',
    'no.use': 'Use',
    'use.title': 'Ask once.<br>It finds, and it saves.',
    'use.q1': '"Find me a few free online drawing tools"',
    'use.a1': 'Get candidate cards — tap the one you like to save it.',
    'use.q2': '"Put these into one group"',
    'use.a2': 'Assemble a topic note in one step, bookmarks and notes together.',
    'use.q3': 'Paste a video link',
    'use.a3': 'Pull out the title, description and the sites mentioned in its subtitles, then turn them into a note.',
    'use.fine': 'AI is a PRO feature with a lifetime free trial. AI output is for reference only.',
    'use.cta': 'Try the AI assistant',

    'no.promise': 'Promise',
    'promise.title': 'Before you pay,<br>here\'s the fine print.',
    'promise.p1t': 'Your device comes first',
    'promise.p1d': 'Data is kept in your browser by default and everything works without signing in; changes only sync to your account once you turn cloud sync on.',
    'promise.p2t': 'Take it all with you',
    'promise.p2d': 'Export the full library as JSON any time and restore it offline on any device — no account required.',
    'promise.p3t': 'Credentials encrypted on device',
    'promise.p3d': 'Only the account field is end-to-end encrypted: it is encrypted on your device before upload and the server cannot decrypt it; titles, URLs and notes are stored as plain text. Images in notes live in public storage — don\'t put sensitive images there.',
    'promise.p4t': 'No auto-renewal',
    'promise.p4d': 'No paid plan charges you automatically; renew when you want, and the price is fixed for the term. See the <a href="/legal/refund-policy.html">refund policy</a>.',
    'promise.p5t': 'Expiry doesn\'t lock your data',
    'promise.p5d': 'When PRO ends you drop back to Free: bookmarks, notes and sync keep working; only PRO features turn off.',

    'no.pricing': 'Pricing',
    'price.title': 'Start free.<br>Upgrade when you want AI.',
    'price.free': 'Free',
    'price.freeSub': 'Free forever, no payment details needed',
    'price.f.free1': 'Unlimited bookmarks, categories & notes',
    'price.f.free2': 'Multi-device sync; only the account field is end-to-end encrypted',
    'price.f.free3': 'Free trial of AI autofill & chat',
    'price.f.free4': 'Basic link checks & cloud version history',
    'price.freeCta': 'Start for free',
    'price.proSub': 'Monthly, quarterly or yearly — longer terms cost less',
    'price.f.pro1': 'Everything in Free',
    'price.f.pro2': 'AI autofill, page enrichment & chat',
    'price.f.pro3': 'Automatic whole-library link patrol',
    'price.f.pro4': 'Longer cloud version history',
    'price.f.pro5': 'More link checks & light platform parses',
    'price.proCta': 'See prices & upgrade',
    'price.note': 'Current prices and quotas are shown on the in-app purchase page. No plan renews automatically.',

    'faq.title': 'FAQ',
    'faq.q1': 'Where does my data live?',
    'faq.a1': 'By default only in your browser (IndexedDB); nothing is uploaded. With cloud sync on, changes sync incrementally to your account: only the account field is encrypted on your device before upload, while titles, URLs and notes are stored as plain text. Images embedded in notes go to public storage and anyone with the link can open them, so please don\'t put sensitive images there. A full JSON export is available any time.',
    'faq.q2': 'What about switching devices or browsers?',
    'faq.a2': 'Sign in to the same account and changes sync automatically; or export everything as JSON and import it offline on any device.',
    'faq.q3': 'How is this different from browser bookmarks?',
    'faq.a3': 'Browser bookmarks are tied to one browser and device, with nowhere to write notes. ulink adds nested sub-bookmarks, rich-text notes, instant pinyin search and private link sharing.',
    'faq.q4': 'What happens when my AI trial runs out?',
    'faq.a4': 'Only the AI features need PRO to keep going; bookmarks, notes, sync and everything else are unaffected.',
    'faq.q5': 'What happens to my data when PRO expires?',
    'faq.a5': 'Your account drops back to Free. Bookmarks, notes and sync keep working and PRO-only features turn off; cloud version history is trimmed to the Free retention period. Nothing is charged automatically.',
    'faq.q6': 'Can I get a refund?',
    'faq.a6': 'You can request one — see the <a href="/legal/refund-policy.html">refund policy</a> for the conditions and process.',

    'closing.title': 'Start linking your library today.',
    'cta.start2': 'Get started',
    'closing.ext': 'Install the browser extension',
    'closing.meta': 'No sign-up needed · Free to start · No auto-renewal',
    'foot.rights': '© 2026 ulink.ren · ulink',
    'foot.aria': 'Footer links',
    'foot.terms': 'Terms of service',
    'foot.privacy': 'Privacy policy',
    'foot.refund': 'Refund policy',
    'lang.labelFoot': '中文'
  };
  var EN_TITLE = 'ulink — turn scattered links into your own knowledge';

  function resolveLocale() {
    // 与 functions/s/[gid].ts 的 resolveLocale 顺序一致：?lang= 优先
    var m = /[?&]lang=(zh|en)/.exec(location.search);
    if (m) return m[1] === 'zh' ? 'zh-CN' : 'en-US';
    try {
      var saved = localStorage.getItem(LOCALE_KEY);
      if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch (e) { /* ignore */ }
    return /^zh/i.test(navigator.language || '') ? 'zh-CN' : 'en-US';
  }

  function each(sel, fn) {
    var nodes = document.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  /** 把页面应用到英文（中文是静态默认，无需反操作） */
  function applyEnglish() {
    each('[data-i18n]', function (el) {
      var t = EN[el.getAttribute('data-i18n')];
      if (typeof t === 'string') el.textContent = t;
    });
    each('[data-i18n-html]', function (el) {
      var t = EN[el.getAttribute('data-i18n-html')];
      if (typeof t === 'string') el.innerHTML = t;
    });
    each('[data-i18n-aria]', function (el) {
      var t = EN[el.getAttribute('data-i18n-aria')];
      if (typeof t === 'string') el.setAttribute('aria-label', t);
    });
    each('[data-i18n-alt]', function (el) {
      var t = EN[el.getAttribute('data-i18n-alt')];
      if (typeof t === 'string') el.setAttribute('alt', t);
    });
    each('img[data-src-en]', function (img) {
      var size = (img.getAttribute('data-size-en') || '').split('x');
      if (size.length === 2) {
        img.setAttribute('width', size[0]);
        img.setAttribute('height', size[1]);
      }
      img.setAttribute('src', img.getAttribute('data-src-en'));
    });
    document.documentElement.lang = 'en-US';
    document.title = EN_TITLE;
    setToggleLabels(false);
  }

  /** 两个语言切换入口的可见标签 = 目标语言 */
  function setToggleLabels(isZh) {
    var toggle = document.getElementById('lang-toggle');
    if (toggle) toggle.textContent = isZh ? 'EN' : '中文';
    var foot = document.getElementById('lang-toggle-foot');
    if (foot) foot.textContent = isZh ? 'English' : '中文';
  }

  function bindToggles() {
    ['lang-toggle', 'lang-toggle-foot'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var isZh = document.documentElement.lang !== 'en-US';
        var next = isZh ? 'en-US' : 'zh-CN';
        try { localStorage.setItem(LOCALE_KEY, next); } catch (e) { /* ignore */ }
        if (next === 'en-US') {
          applyEnglish();
          if (knot) knot.build();
        } else {
          // 切回中文 = 整页还原为静态原文；reload 后 resolveLocale() 读到 lv_locale=zh-CN，
          // zh 分支为无操作，不会形成循环
          location.reload();
        }
      });
    });
  }

  /* ── 页面增强 ── */
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** 顶栏吸顶后加分隔线 */
  function initStick() {
    var top = document.querySelector('.top');
    if (!top) return;
    function onStick() { top.classList.toggle('is-stuck', window.scrollY > 8); }
    window.addEventListener('scroll', onStick, { passive: true });
    onStick();
  }

  /** 入场：轻微上移淡入，进入视口一次性加 .in */
  function initReveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    each('.display, .hero-foot, .promises, .hero-shot, .steps, .scene-shot, .organize-stage, .facts, .use-shot, .dialog, .pledges, .plans, .faq', function (el) {
      el.classList.add('rv');
      io.observe(el);
    });
  }

  /**
   * 「结」线：把标志里蓝绿两笔的交缠拉成贯穿全页的细线，经过每个 [data-knot] 锚点时交叉一次，
   * 随滚动逐段描出；窄屏由 CSS 隐藏，减少动效偏好下直接画全。
   */
  var knot = null;
  function initKnot() {
    var main = document.querySelector('main');
    var svg = document.querySelector('.knot');
    if (!main || !svg) return null;
    var pb = svg.querySelector('.knot-b');
    var pg = svg.querySelector('.knot-g');
    var lenB = 0, lenG = 0, span = [0, 1], nodes = [];

    function build() {
      if (getComputedStyle(svg).display === 'none') return;
      var anchors = Array.prototype.slice.call(document.querySelectorAll('[data-knot]'));
      if (anchors.length < 2) return;
      var mr = main.getBoundingClientRect();
      // 轴线固定在正文左缘外 54px（取 .wrap 的内容区左缘），不跟随锚点所在列：
      // 「用」那屏锚点在右栏，跟着走会让线横穿截图
      var wrap = main.querySelector('.wrap');
      var wr = wrap.getBoundingClientRect();
      var axis = wr.left - mr.left + parseFloat(getComputedStyle(wrap).paddingLeft) - 54;
      var pts = anchors.map(function (el) {
        var r = el.getBoundingClientRect();
        return { x: axis, y: r.top - mr.top + r.height / 2 };
      });
      var last = pts[pts.length - 1];
      pts.push({ x: last.x, y: last.y + 120 });
      function strand(sign) {
        var d = 'M ' + pts[0].x + ' ' + pts[0].y;
        for (var i = 0; i < pts.length - 1; i++) {
          var a = pts[i], b = pts[i + 1], dy = b.y - a.y;
          var s = sign * (i % 2 === 0 ? 1 : -1);
          // 两股在每个锚点交叉；鼓起最多 32px，始终留在页边距里，不压正文
          var bow = Math.min(32, Math.max(12, dy * 0.04));
          d += ' C ' + (a.x + s * bow) + ' ' + (a.y + dy * 0.25) + ', ' +
               (b.x + s * bow) + ' ' + (b.y - dy * 0.25) + ', ' + b.x + ' ' + b.y;
        }
        return d;
      }
      pb.setAttribute('d', strand(1));
      pg.setAttribute('d', strand(-1));
      lenB = pb.getTotalLength();
      lenG = pg.getTotalLength();
      pb.style.strokeDasharray = lenB + ' ' + lenB;
      pg.style.strokeDasharray = lenG + ' ' + lenG;
      // 每个锚点放一个「结点」：线描到这里时点亮
      Array.prototype.slice.call(svg.querySelectorAll('circle')).forEach(function (c) { svg.removeChild(c); });
      nodes = pts.slice(0, -1).map(function (pt) {
        var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt.x);
        c.setAttribute('cy', pt.y);
        c.setAttribute('r', 4.5);
        c.setAttribute('class', 'knot-node');
        svg.appendChild(c);
        return { el: c, y: pt.y };
      });
      span = [pts[0].y, pts[pts.length - 1].y];
      draw();
    }

    function draw() {
      if (!lenB) return;
      var mr = main.getBoundingClientRect();
      // 视口 65% 处为「笔尖」：笔尖走到哪，线就描到哪
      var tip = window.innerHeight * 0.65 - mr.top;
      var p = reduce ? 1 : Math.max(0, Math.min(1, (tip - span[0]) / (span[1] - span[0])));
      pb.style.strokeDashoffset = String(lenB * (1 - p));
      pg.style.strokeDashoffset = String(lenG * (1 - Math.max(0, p - 0.02)));
      var reach = span[0] + p * (span[1] - span[0]);
      nodes.forEach(function (n) { n.el.classList.toggle('on', reach >= n.y - 2); });
    }

    var raf = 0;
    window.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; draw(); });
    }, { passive: true });
    window.addEventListener('resize', build);
    // 图片与字体加载会改变锚点位置
    window.addEventListener('load', build);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
    build();
    return { build: build };
  }

  function boot() {
    if (resolveLocale() === 'en-US') applyEnglish();
    else setToggleLabels(true);
    document.documentElement.removeAttribute('data-lv-boot');
    initStick();
    initReveal();
    knot = initKnot();
    bindToggles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
