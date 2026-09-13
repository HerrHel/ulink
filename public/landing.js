/*
 * 与链 ulink — 宣传落地页脚本（/ 首页专用，无框架零依赖）
 *
 * 职责（与 app 内代码零耦合，键名与 src/i18n、persist.ts 保持一致）：
 *  1. 返客秒跳 —— localStorage 已有应用痕迹的老用户直接 location.replace('/app')，
 *     先于首帧绘制（本脚本阻塞加载于 <head>），老书签/已装 PWA 的旧入口无感迁移；
 *  2. 关键参数直通 —— 不论新老用户，凡是带「任务上下文」的 URL（扩展保存
 *     ?ext_save、系统分享 share_target 参数、#share/ 旧分享兜底、Supabase
 *     token/错误参数）一律透传 search+hash 直达 /app，不落入宣传页；
 *  3. 老用户一次性曝光 —— ?stay=1 豁免秒跳（应用内官网书签/手动分享链接携带）；
 *     无豁免时老用户仅在首次访问 / 时看到落地页（写入 lv_landing_seen_v1），
 *     之后恢复秒跳 —— 宣传页对老用户是低频信息，不做反复打扰；
 *  4. 双语切换 —— 中文是 HTML 静态默认（SEO 与全站惯例一致）；切到英文由本脚本
 *     按 ?lang= → lv_locale → navigator.language（与 /s/* 的 resolveLocale
 *     顺序一致）即时替换 data-i18n 文案；切回中文整页还原（reload 到静态原文）；
 *  5. 页面增强 —— 滚动显现（.reveal）、视图演示卡填充、主题/深浅色演示切换。
 */
(function () {
  'use strict';

  var LOCALE_KEY = 'lv_locale';            // 与 src/i18n/index.ts 的 LOCALE_KEY 一致
  var APP_PATH = '/app';
  var SEEN_KEY = 'lv_landing_seen_v1';     // 老用户一次性曝光标记（版本化，bump 可重新曝光）

  /* ── 1 & 2 & 3：跳转决策（head 阻塞期执行，DOM 无需就绪） ── */
  var search = location.search;
  var hash = location.hash;
  // share_target 发送 ?title=&text=&url=（扩展走 ?ext_save=1&ext_save_url=...）
  var hasSaveFlow = /[?&](ext_save|title|text|url)=/.test(search);
  // 旧分享兜底路由：/#share/<gid>、/#share/c/<id>
  var hasShareHash = /^#share\/(c\/)?/.test(hash);
  // Supabase 隐式流 token 走 hash（#access_token=...），PKCE code / 错误走 query
  var hasAuthPayload = /access_token|refresh_token|error_description/.test(hash) ||
    /[?&](code|error|error_description)=/.test(search);
  var returning = false;
  var seen = false;
  try {
    // persist.ts 每次保存都写 localStorage 缓存（linkvault_v2）；
    // lv_setup_done 是首启引导完成标记。二者任一存在即视为老用户。
    returning = !!(localStorage.getItem('linkvault_v2') || localStorage.getItem('lv_setup_done'));
    seen = !!localStorage.getItem(SEEN_KEY);
  } catch (e) { /* 隐私模式等存取失败时按新访客处理 */ }
  // 任务上下文优先级最高：stay/曝光规则都拦不住它
  var missionParams = hasSaveFlow || hasShareHash || hasAuthPayload;
  // ?stay=1：显式要看落地页（应用内官网书签即带此参数），豁免秒跳
  var stayRequested = /[?&]stay=1/.test(search);

  if (missionParams || (returning && !stayRequested && seen)) {
    location.replace(APP_PATH + search + hash);
    return; // 跳转中，不再做页面增强
  }
  // 本次落地页确定渲染（新访客 / stay 豁免 / 老用户首次曝光），记录已见。
  // 新访客也写入：避免其成为老用户后被二次强制曝光（首次到达即已看过）。
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }

  // JS 可用标记：CSS 据此启用「滚动显现」初始隐藏态（无 JS 时内容直接可见）
  document.documentElement.className += ' js';

  /* ── 4：双语 ── */
  // 英文字典（中文是 HTML 内的静态默认，无需字典）
  var EN = {
    'head.login': 'Sign in',
    'head.start': 'Start free',
    'hero.pill': 'Offline-first · End-to-End Zero-Knowledge Encrypted · Free Public Distribution',
    'hero.title1': 'Save, organize & share,',
    'hero.title2': ' anywhere',
    'hero.sub': 'ulink is a next-generation professional bookmark and knowledge management system: tree-nested sub-bookmarks, multidimensional attribute filtering, end-to-end zero-knowledge encryption, and one-click public Fork collaboration.',
    'hero.explore': 'Explore Features',
    'hero.note': 'Ready out-of-the-box · Local authority storage · End-to-end zero-knowledge encrypted · Free & open distribution',
    'cta.start': 'Get started',
    'why.eyebrow': 'Deep Organization',
    'why.title': 'Why ulink',
    'manage.title': 'Deep Organization: Connect Links & People',
    'manage.sub': '“ulink” means “Connect Links & People” (ulink.ren). Move beyond flat bookmark bars and establish structured topology across links and knowledge.',
    'm1.t': 'Tree-nested Sub-bookmarks',
    'm1.d': 'Deconstruct complex web structures. Mount documentation, consoles, and repositories seamlessly under a single entry.',
    'm2.t': 'Taxonomy & Rich-text Notebooks',
    'm2.d': 'Categorize workspaces with clear boundaries; write full-featured notebooks with @ card references and focused editing.',
    'm3.t': 'Custom Attribute Slicing',
    'm3.d': 'Define multidimensional attribute tags with boolean intersection filtering for sub-millisecond precision discovery.',
    'sync.eyebrow': 'Sync & Privacy',
    'sync.title': 'Real-time Multi-device Sync, Zero-Knowledge Encryption',
    'sync.d1': 'Eliminate vendor lock-in and device-loss risks. Millisecond incremental sync with deterministic conflict resolution and revision history.',
    'sync.d2': 'Credentials and passwords are physically encrypted on-device via AES-256-GCM before upload. The cloud remains zero-knowledge.',
    'dev.l': 'This Device · Authority Store',
    'dev.r': 'Mobile · Realtime Synced',
    'dev.c': 'End-to-End Zero-Knowledge Encryption',
    'looks.eyebrow': 'Design System',
    'looks.title': 'Simple, Refined: Crafted to the Pixel',
    'looks.sub': 'Dual efficiency and comfort palettes, seamless dark/light modes, and three flexible views — grid, list, and compact mini-grid.',
    'theme.aria': 'Theme style',
    'theme.eff': 'Efficiency',
    'theme.comfort': 'Comfort',
    'mode.aria': 'Color scheme',
    'mode.light': 'Light mode',
    'mode.dark': 'Dark mode',
    'view.grid': 'Grid',
    'view.list': 'List',
    'view.mini': 'Mini grid',
    'looks.note': 'Visual theme and view preferences are persisted per device and roam globally upon sign-in.',
    'create.eyebrow': 'Collaboration',
    'create.title': 'Connect & Fork Knowledge Freely',
    'create.d1': 'Publish collections or notebooks with a single link. Visitors explore with zero sign-up and can fork independent local copies with one click.',
    'create.d2': 'Integrated TipTap editor with headings, highlights, task checklists, and @ card mentions — bridging collection and creation in a natural closed loop.',
    'cm.n1': 'Creator · Outgoing Link',
    'cm.n2': 'Visitor · Zero Sign-up Reading',
    'cm.n3': '⚡ One-click Fork Copy',
    'cm.n4': '📱 Multi-device Responsive',
    'cm.public': 'Public Share',
    'cm.fork': 'Fork Copy',
    'extra.eyebrow': 'Crafted Details',
    'extra.title': 'And Thoughtful Everyday Delights',
    'x1.t': 'One-keystroke Capture',
    'x1.d': 'Press ',
    'x1.d2': ' in Chrome extension to file the page and notes immediately.',
    'x2.t': 'Offline-first Architecture & PWA',
    'x2.d': 'Built upon IndexedDB authority storage; installable on desktop and mobile with full offline functionality.',
    'x5.t': 'Fluid Drag & Drop',
    'x5.d': 'Freely reorder cards, drop into categories or group notes to cite; native 60fps gesture physics on mobile.',
    'x3.t': 'Pinyin & Instant Fuzzy Search',
    'x3.d': 'Type “js” to find 键盘快捷键 (keyboard shortcuts) — no need to recall full names.',
    'x4.t': 'Safety Trash & Multi-step Undo',
    'x4.d': 'Full undo/redo history stack and safety trash can recovery prevent accidental losses.',
    'faq.eyebrow': 'FAQ',
    'faq.title': 'Frequently Asked Questions',
    'q2': 'Where does my data live?',
    'a2': 'By default, it lives only in your browser (IndexedDB) with zero server tracking. With cloud sync enabled, incremental data syncs to your account — credentials are encrypted with AES-256-GCM before leaving your device.',
    'q3': 'What about switching devices or browsers?',
    'a3': 'Sign in to sync in milliseconds; you can also export a full JSON backup file anytime and import it on any device.',
    'q4': 'How does this differ from browser bookmarks?',
    'a4': 'It travels across browsers and devices, supports sub-bookmark nesting, rich-text notebook groups, pinyin search, public sharing, and one-click capture via extension.',
    'cta.title': 'Link your library together today',
    'cta.sub': 'Works immediately without sign-up · Import existing browser bookmarks in seconds',
    'foot.slogan': 'Collect · Organize · Share',
    'foot.privacy': 'Privacy policy',
    'foot.rights': '© 2026 ulink.ren · ulink',
    'foot.note': 'Ready to use · Privacy in your control · Cloud sync optional',
    'lang.aria': 'Switch to 中文',
    'lang.labelFoot': '中文'
  };
  var EN_TITLE = 'ulink — collect, organize & share, anywhere';

  function resolveLocale() {
    // 与 functions/s/[gid].ts 的 resolveLocale 顺序一致：?lang= 优先
    var m = /[?&]lang=(zh|en)/.exec(search);
    if (m) return m[1] === 'zh' ? 'zh-CN' : 'en-US';
    try {
      var saved = localStorage.getItem(LOCALE_KEY);
      if (saved === 'zh-CN' || saved === 'en-US') return saved;
    } catch (e) { /* ignore */ }
    return /^zh/i.test(navigator.language || '') ? 'zh-CN' : 'en-US';
  }

  /** 把页面应用到英文（中文是静态默认，无需反操作） */
  function applyEnglish() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = EN[el.getAttribute('data-i18n')];
      if (typeof text === 'string') el.textContent = text;
    }
    var labelled = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < labelled.length; j++) {
      var aria = EN[labelled[j].getAttribute('data-i18n-aria')];
      if (typeof aria === 'string') labelled[j].setAttribute('aria-label', aria);
    }
    document.documentElement.lang = 'en-US';
    document.title = EN_TITLE;
    setToggleLabels(false);
    populateDemo();
    if (window.__updateDemoGliders) {
      requestAnimationFrame(function () {
        window.__updateDemoGliders(true);
      });
    }
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
        } else {
          // 切回中文 = 整页还原为静态原文；reload 后 resolveLocale() 读到 lv_locale=zh-CN
          // 但 zh 分支为无操作，不会形成循环
          location.reload();
        }
      });
    });
  }

  /* ── 5：页面增强 ── */
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 滚动显现：进入视口一次性加 .in */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (reducedMotion || !('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) els[i].classList.add('in');
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) {
        if (entries[k].isIntersecting) {
          entries[k].target.classList.add('in');
          io.unobserve(entries[k].target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }

  var DEMO_ITEMS = [
    { title: '工作台', titleEn: 'Workspace', domain: 'workspace.io', tag: '日常', tagEn: 'Daily', icon: '作', iconEn: 'WK', color: '#122E8A', isTheme: true },
    { title: '设计库', titleEn: 'Design Hub', domain: 'design.assets', tag: '创意', tagEn: 'Design', icon: '设', iconEn: 'DS', color: '#7C3AED' },
    { title: '阅读清单', titleEn: 'Reading List', domain: 'reading.digest', tag: '知识', tagEn: 'Read', icon: '阅', iconEn: 'RD', color: '#0D9488' },
    { title: 'AI 助手', titleEn: 'AI Tools', domain: 'ai.models', tag: '智能', tagEn: 'AI', icon: 'AI', iconEn: 'AI', color: '#2563EB' },
    { title: '灵感集', titleEn: 'Inspirations', domain: 'inspo.gallery', tag: '素材', tagEn: 'Inspo', icon: '灵', iconEn: 'IN', color: '#EA580C' },
    { title: '云服务', titleEn: 'Cloud Ops', domain: 'cloud.console', tag: '工具', tagEn: 'Ops', icon: '云', iconEn: 'CL', color: '#475569' },
    { title: '财务账单', titleEn: 'Finance', domain: 'finance.ledger', tag: '资产', tagEn: 'Pay', icon: '财', iconEn: 'FN', color: '#059669' },
    { title: '学习笔记', titleEn: 'Study Notes', domain: 'notes.study', tag: '资料', tagEn: 'Notes', icon: '学', iconEn: 'ST', color: '#D97706' }
  ];

  /** 视图演示：填充三种视图的滚动卡片（拟真微缩 UI） */
  function populateDemo() {
    var cols = [
      { id: 'demo-col-grid', type: 'grid' },
      { id: 'demo-col-list', type: 'list' },
      { id: 'demo-col-mini', type: 'mini' }
    ];
    var isEn = document.documentElement.lang === 'en-US';
    for (var c = 0; c < cols.length; c++) {
      var col = document.getElementById(cols[c].id);
      if (!col) continue;
      col.innerHTML = '';
      var type = cols[c].type;
      // 双份内容 + translateY(-50%) 无缝循环
      for (var rep = 0; rep < 2; rep++) {
        for (var i = 0; i < DEMO_ITEMS.length; i++) {
          var item = DEMO_ITEMS[i];
          var card = document.createElement('div');
          card.className = 'mk-card';

          var icon = document.createElement('div');
          icon.className = 'mk-icon' + (item.isTheme ? ' mk-icon-accent' : '');
          if (!item.isTheme) {
            icon.style.background = item.color;
          }
          icon.textContent = isEn ? (item.iconEn || item.icon) : item.icon;

          var name = document.createElement('div');
          name.className = 'mk-name';
          name.textContent = isEn ? (item.titleEn || item.title) : item.title;

          if (type === 'grid') {
            var head = document.createElement('div');
            head.className = 'mk-head';
            head.appendChild(icon);
            var titleWrap = document.createElement('div');
            titleWrap.style.minWidth = '0';
            titleWrap.style.flex = '1';
            titleWrap.appendChild(name);
            var domain = document.createElement('div');
            domain.className = 'mk-domain';
            domain.textContent = item.domain;
            titleWrap.appendChild(domain);
            head.appendChild(titleWrap);
            card.appendChild(head);

            var tag = document.createElement('span');
            tag.className = 'mk-tag';
            tag.textContent = isEn ? (item.tagEn || item.tag) : item.tag;
            card.appendChild(tag);

            var foot = document.createElement('div');
            foot.className = 'mk-foot';
            foot.innerHTML = '<span><i class="mk-dot"></i>42</span><span class="mk-arrow">↗</span>';
            card.appendChild(foot);
          } else if (type === 'list') {
            var main = document.createElement('div');
            main.className = 'mk-main';
            main.appendChild(icon);
            main.appendChild(name);
            var tagL = document.createElement('span');
            tagL.className = 'mk-tag';
            tagL.textContent = isEn ? (item.tagEn || item.tag) : item.tag;
            main.appendChild(tagL);
            card.appendChild(main);

            var hint = document.createElement('span');
            hint.className = 'mk-hint';
            hint.textContent = '↗';
            card.appendChild(hint);
          } else {
            // mini
            card.appendChild(icon);
            card.appendChild(name);
          }
          col.appendChild(card);
        }
      }
    }
  }

  /** 主题 / 深浅色演示切换（只作用于演示舞台，不写应用偏好） */
  function initDemoControls() {
    var looks = document.getElementById('looks');
    var stage = document.getElementById('demo-stage');
    if (!stage) return;

    var segs = document.querySelectorAll('.looks .seg');

    function updateGliders(animate) {
      for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        var glider = seg.querySelector('.seg-glider');
        var activeBtn = seg.querySelector('button[aria-pressed="true"]');
        if (!glider || !activeBtn) continue;
        if (!animate) {
          glider.style.transition = 'none';
        }
        var left = activeBtn.offsetLeft;
        var top = activeBtn.offsetTop;
        var w = activeBtn.offsetWidth;
        var h = activeBtn.offsetHeight;
        glider.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
        glider.style.width = w + 'px';
        glider.style.height = h + 'px';
        if (!animate) {
          glider.offsetHeight; // force reflow
          glider.style.transition = '';
        } else {
          glider.classList.remove('pulse');
          void glider.offsetWidth; // trigger reflow for pulse animation
          glider.classList.add('pulse');
        }
      }
    }

    function bindGroup(attr, key) {
      var btns = document.querySelectorAll('[data-' + attr + ']');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function (e) {
          var target = e.currentTarget;
          var val = target.getAttribute('data-' + attr);
          if (looks) looks.setAttribute('data-' + key, val);
          stage.setAttribute('data-' + key, val);
          if (key === 'mode') {
            document.documentElement.setAttribute('data-theme', val);
            try {
              window.dispatchEvent(new CustomEvent('lv-demo-mode-change', { detail: val }));
            } catch (err) {}
          }
          var group = target.parentElement;
          var all = group.querySelectorAll('button');
          for (var k = 0; k < all.length; k++) {
            all[k].setAttribute('aria-pressed', all[k] === target ? 'true' : 'false');
          }
          updateGliders(true);
        });
      }
    }

    bindGroup('demo-style', 'style');
    bindGroup('demo-mode', 'mode');

    // 初始位置测算（无动效）
    updateGliders(false);

    // 屏幕尺寸变更 / 旋转重同步
    window.addEventListener('resize', function () {
      updateGliders(false);
    });

    // 字体就绪后重新校验位置（消除 WebFont 导致的宽度差异）
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        updateGliders(false);
      });
    }

    window.__updateDemoGliders = updateGliders;
  }

  function boot() {
    if (resolveLocale() === 'en-US') applyEnglish();
    else setToggleLabels(true);
    bindToggles();
    populateDemo();
    initDemoControls();
    initReveal();
    document.documentElement.removeAttribute('data-lv-boot');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
