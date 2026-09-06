/*
 * 与链 ulink — 宣传落地页脚本（/ 首页专用，无框架零依赖）
 *
 * 职责（与 app 内代码零耦合，键名与 src/i18n、persist.ts 保持一致）：
 *  1. 返客秒跳 —— localStorage 已有应用痕迹的老用户直接 location.replace('/app')，
 *     先于首帧绘制（本脚本阻塞加载于 <head>），老书签/已装 PWA 的旧入口无感迁移；
 *  2. 关键参数直通 —— 不论新老用户，凡是带「任务上下文」的 URL（扩展保存
 *     ?ext_save、系统分享 share_target 参数、#share/ 旧分享兜底、Supabase
 *     token/错误参数）一律透传 search+hash 直达 /app，不落入宣传页；
 *  3. 双语切换 —— 中文是 HTML 静态默认（SEO 与全站惯例一致）；切到英文由本脚本
 *     按 ?lang= → lv_locale → navigator.language（与 /s/* 的 resolveLocale
 *     顺序一致）即时替换 data-i18n 文案；切回中文整页还原（reload 到静态原文）。
 */
(function () {
  'use strict';

  var LOCALE_KEY = 'lv_locale';            // 与 src/i18n/index.ts 的 LOCALE_KEY 一致
  var APP_PATH = '/app';

  /* ── 1 & 2：返客秒跳 + 关键参数直通（head 阻塞期执行，DOM 无需就绪） ── */
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
  try {
    // persist.ts 每次保存都写 localStorage 缓存（linkvault_v2）；
    // lv_setup_done 是首启引导完成标记。二者任一存在即视为老用户。
    returning = !!(localStorage.getItem('linkvault_v2') || localStorage.getItem('lv_setup_done'));
  } catch (e) { /* 隐私模式等存取失败时按新访客处理 */ }

  if (returning || hasSaveFlow || hasShareHash || hasAuthPayload) {
    location.replace(APP_PATH + search + hash);
    return; // 跳转中，不再做语言增强
  }

  /* ── 3：双语 ── */
  // 英文字典（中文是 HTML 内的静态默认，无需字典）
  var EN = {
    'nav.features': 'Features',
    'nav.steps': 'Get started',
    'nav.faq': 'FAQ',
    'nav.start': 'Start free',
    'hero.title1': 'Your bookmarks, ',
    'hero.title2': 'one living web',
    'hero.sub': 'ulink is a local-first bookmark manager: end-to-end encrypted, synced across devices, shareable with a single link — your data stays yours.',
    'cta.start': 'Start for free',
    'cta.more': 'See what it can do',
    'mock.title': 'ulink — my library',
    'mock.search': 'Search bookmarks, groups…',
    'mock.c1t': 'GitHub',
    'mock.c1u': 'github.com',
    'mock.c2t': 'Design · 12',
    'mock.c2a': 'Dribbble',
    'mock.c2c': 'Zcool',
    'mock.pin': 'Pinned',
    'mock.c3t': 'Weekly report',
    'mock.c3u': 'docs.example.com',
    'mock.c4t': 'TypeScript handbook',
    'mock.c5t': 'Daily mix',
    'mock.c5u': 'music.example.com',
    'mock.c6t': 'Shortcuts cheat-sheet',
    'mock.c6u': 'shortcuts.dev',
    'feat.eyebrow': 'Features',
    'feat.title': 'A small, complete bookmark library',
    'feat.intro': 'No bloat — collecting, organizing and finding things again, done properly.',
    'f1.title': 'End-to-end encrypted',
    'f1.desc': 'Sensitive fields like passwords are encrypted on your device before they ever leave it — the server only sees ciphertext.',
    'f2.title': 'Sync across devices',
    'f2.desc': 'Bookmarks, groups and edits sync in real time; conflicts merge automatically and every version stays retrievable.',
    'f3.title': 'Share with a single link',
    'f3.desc': 'Publish a group at its own /s/ link — anyone can browse without an account, and fork it into their own copy in one click.',
    'f4.title': 'Local-first, works offline',
    'f4.desc': 'Your data lives in your own browser and works without a network. Install it as a PWA to your desktop or home screen.',
    'f5.desc1': 'Press ',
    'f5.desc2': ' in the Chrome extension — or share from your OS menu — and the page is filed instantly.',
    'f6.title': 'Organized, and reversible',
    'f6.desc': 'Groups, categories, custom attributes and pinyin-aware search. Mistakes go to trash; actions can be undone.',
    'steps.eyebrow': 'Get started',
    'steps.title': 'Three steps to your ulink',
    's1.t': 'Open and go',
    's1.d': 'No sign-up. Open the app and start filing — data lands locally first.',
    's2.t': 'Connect the cloud',
    's2.d': 'Sign in with an email code; devices sync in real time and every version stays retrievable.',
    's3.t': 'Save anywhere, share anywhere',
    's3.d': "Capture with the extension's shortcut, then publish a group with a single /s/ link.",
    'steps.cta': 'Start now',
    'faq.eyebrow': 'FAQ',
    'faq.title': 'Questions you might have',
    'q1': 'Is it really free?',
    'a1': 'Yes. Local features are completely free with no ads; cloud sync and public sharing are free as of today.',
    'q2': 'Where does my data live?',
    'a2': 'By default, only in your own browser (IndexedDB) — nothing is uploaded. Once you enable cloud sync, data syncs to your account, with password fields end-to-end encrypted: the server only sees ciphertext.',
    'q3': 'What about switching devices or browsers?',
    'a3': 'Sign in with the same account and everything syncs. You can also export your data to a file and import it elsewhere anytime.',
    'q4': 'How is this different from built-in browser bookmarks?',
    'a4': 'It travels across browsers and devices, organizes with groups, attributes and pinyin-aware search, shares publicly, and captures any page via the extension or OS share.',
    'foot.slogan': 'Collect · Organize · Share',
    'foot.privacy': 'Privacy policy',
    'foot.rights': '© 2026 ulink.ren · ulink',
    'foot.note': 'Start without sign-up · Cloud sync optional',
    'lang.aria': 'Switch to 中文',
    'lang.labelFoot': '中文'
  };
  var EN_TITLE = 'ulink — a local-first bookmark manager';

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

  function boot() {
    if (resolveLocale() === 'en-US') applyEnglish();
    else setToggleLabels(true);
    bindToggles();
    document.documentElement.removeAttribute('data-lv-boot');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
