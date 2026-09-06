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
    'hero.title1': 'Save, organize & share,',
    'hero.title2': ' anywhere',
    'hero.sub': 'ulink is a bookmark manager that works the moment you open it: sub-bookmarks, categories and attribute tags keep collections deeply organized; cloud sync keeps them safe across devices; a single link shares them with anyone.',
    'hero.note': 'Free · No sign-up required · Your data lives on your own device',
    'cta.start': 'Get started',
    'why.title': 'Why ulink',
    'manage.title': 'Deep organization: chains within chains',
    'manage.sub': 'Not just storing URLs — every bookmark stays exactly where it belongs.',
    'm1.t': 'Sub-bookmarks',
    'm1.d': 'Hang multiple links under one bookmark — every entrance to a site, gathered in one place.',
    'm2.t': 'Categories & groups',
    'm2.d': 'Categories cut across the sidebar; group cards collect vertically, with in-group search and batch tools.',
    'm3.t': 'Attribute tags',
    'm3.d': 'Define tags like “Requires login” or “AI” — one click to filter, one second to find.',
    'dm.all': 'All',
    'dm.tools': 'Tools',
    'dm.ai': 'AI',
    'dm.parent': 'Dev resources',
    'dm.child1': 'TypeScript handbook',
    'dm.chip1': 'Requires login',
    'dev.l': 'This device',
    'dev.r': 'Phone',
    'dev.c': 'End-to-end encrypted',
    'looks.title': 'Simple, refined',
    'looks.sub': 'Two theme styles, light & dark, three view modes — the switches below are real, try them.',
    'theme.eff': 'Efficiency',
    'theme.comfort': 'Comfort',
    'view.grid': 'Grid',
    'view.list': 'List',
    'view.mini': 'Mini grid',
    'looks.note': 'Theme and view preferences are remembered per device — and follow you after signing in.',
    'create.title': 'Create & share',
    'create.d1': 'Publish a bookmark collection (a category) or a single group with one link: anyone can browse without an account, and fork it into their own copy in one click.',
    'create.d2': 'A group is a rich-text notebook — headings, colors, task lists, @ mentions that embed bookmark cards. Writing an install guide or a getting-started tutorial fits right in.',
    'cm.tut': 'Install guide',
    'extra.title': 'And the little things',
    'x1.t': 'One-keystroke capture',
    'x1.d': 'Press ',
    'x1.d2': ' in the Chrome extension and the page is filed instantly.',
    'x2.t': 'Offline, installable',
    'x2.d': 'Install as a PWA to your desktop or home screen; works without a network.',
    'x3.t': 'Pinyin fuzzy search',
    'x3.d': 'Type “js” to find 键盘快捷键 — perfect recall of full names not required.',
    'x4.t': 'Trash & undo',
    'x4.d': 'Deleted items go to trash, actions can be undone — nothing is ever lost to a slip.',
    'faq.title': 'FAQ',
    'q1': 'Is it really free?',
    'a1': 'Yes. Local features are completely free with no ads; cloud sync and public sharing are free as of today.',
    'q2': 'Where does my data live?',
    'a2': 'By default, only in your own browser (IndexedDB) — nothing is uploaded. Once you enable cloud sync, data syncs to your account, with password fields end-to-end encrypted: the server only sees ciphertext.',
    'q3': 'What about switching devices or browsers?',
    'a3': 'Sign in with the same account and everything syncs. You can also export your data to a file and import it elsewhere anytime.',
    'q4': 'How is this different from built-in browser bookmarks?',
    'a4': 'It travels across browsers and devices, organizes with groups, attributes and pinyin-aware search, shares publicly, and captures any page via the extension or OS share.',
    'cta.title': 'Link your library together',
    'cta.sub': 'Open it and start — no account needed.',
    'foot.slogan': 'Collect · Organize · Share',
    'foot.privacy': 'Privacy policy',
    'foot.rights': '© 2026 ulink.ren · ulink',
    'foot.note': 'Start without sign-up · Cloud sync optional',
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

  /** 视图演示：填充三种视图的滚动卡片（装饰性，aria-hidden 区域内） */
  function populateDemo() {
    var items = ['github.com', 'figma.com', 'notion.so', 'mail.qq.com', 'zhihu.com', 'douban.com', 'store.steam', 'deepseek'];
    var cols = ['demo-col-grid', 'demo-col-list', 'demo-col-mini'];
    for (var c = 0; c < cols.length; c++) {
      var col = document.getElementById(cols[c]);
      if (!col) continue;
      // 双份内容 + translateY(-50%) 无缝循环
      for (var rep = 0; rep < 2; rep++) {
        for (var i = 0; i < items.length; i++) {
          var card = document.createElement('div');
          card.className = 'mk-card';
          var dot = document.createElement('i');
          var label = document.createElement('b');
          label.textContent = items[i];
          card.appendChild(dot);
          card.appendChild(label);
          col.appendChild(card);
        }
      }
    }
  }

  /** 主题 / 深浅色演示切换（只作用于演示舞台，不写应用偏好） */
  function initDemoControls() {
    var stage = document.getElementById('demo-stage');
    if (!stage) return;
    function bindGroup(attr, key) {
      var btns = document.querySelectorAll('[data-' + attr + ']');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function (e) {
          var val = e.currentTarget.getAttribute('data-' + attr);
          stage.setAttribute('data-' + key, val);
          var group = e.currentTarget.parentElement;
          var all = group.querySelectorAll('button');
          for (var k = 0; k < all.length; k++) {
            all[k].setAttribute('aria-pressed', all[k] === e.currentTarget ? 'true' : 'false');
          }
        });
      }
    }
    bindGroup('demo-style', 'style');
    bindGroup('demo-mode', 'mode');
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
