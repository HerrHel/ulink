/**
 * 分享页样式（从 share-render.ts 拆出，纯字符串常量，零依赖）。
 * 设计令牌对齐主站 src/styles/tokens.css / cards.css；改动后跑 `node scripts/build-fn-assets.mjs` 重新派生云函数产物。
 */
export const CSS = `
/* ==================== DESIGN TOKENS (对齐主站 tokens.css) ==================== */
:root, [data-theme="light"] {
  color-scheme: light;
  --bg: #F5EFEA;
  --bg-alt: #EDE4DA;
  --surface: #FDFBF9;
  --surface-hover: #F7F2EC;
  --surface-active: #EFE8DF;
  --border: #E5DDD3;
  --border-light: #EFE8DF;
  --border-hover: #D5CBBE;
  --text: #2C2824;
  --text-secondary: #5E5852;
  --text-muted: #6A6660;
  --accent: #122E8A;
  --brand-logo-blue: #122E8A;
  --brand-logo-green: #10B981;
  --brand-logo-text: #122E8A;
  --accent-light: rgba(18, 46, 138, 0.07);
  --accent-glow: rgba(18, 46, 138, 0.15);
  --accent-grad: linear-gradient(135deg, #122E8A 0%, #1E40AF 100%);
  --shadow-xs: 0 1px 2px rgba(44, 40, 36, 0.03);
  --shadow-sm: 0 1px 3px rgba(44, 40, 36, 0.04), 0 1px 2px rgba(44, 40, 36, 0.02);
  --shadow-md: 0 4px 16px -2px rgba(44, 40, 36, 0.05), 0 2px 4px rgba(44, 40, 36, 0.02);
  --shadow-lg: 0 12px 32px -4px rgba(44, 40, 36, 0.07), 0 4px 12px rgba(44, 40, 36, 0.025);
  --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, 0 1px 3px rgba(44, 40, 36, 0.04), 0 0 0 1px var(--border-light);
  --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, 0 8px 24px -4px rgba(44, 40, 36, 0.08), 0 2px 6px rgba(44, 40, 36, 0.03);
  --radius-sm: 6px;
  --radius-base: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 999px;
  --font-sans: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-display: 'Clash Display', 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --bar-bg: rgba(245, 239, 234, 0.82);
  --bar-border: rgba(229, 221, 211, 0.75);
  --bar-shadow: 0 1px 2px rgba(44, 40, 36, 0.02), 0 4px 16px -4px rgba(44, 40, 36, 0.03);
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #1A1A1D;
  --bg-alt: #202025;
  --surface: #25252B;
  --surface-hover: #2E2E35;
  --surface-active: #383842;
  --border: #2F2F36;
  --border-light: #28282F;
  --border-hover: #3D3D46;
  --text: #EEE9E2;
  --text-secondary: #B5AFA6;
  --text-muted: #9B968E;
  --accent: #4A90F7;
  --brand-logo-blue: #4A90F7;
  --brand-logo-green: #E2E7BF;
  --brand-logo-text: #4A90F7;
  --accent-light: rgba(74, 144, 247, 0.08);
  --accent-glow: rgba(74, 144, 247, 0.10);
  --accent-grad: linear-gradient(135deg, #4A90F7 0%, #2360DA 100%);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.25);
  --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.13) inset, 0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.25);
  --bar-bg: rgba(26, 26, 29, 0.82);
  --bar-border: rgba(255, 255, 255, 0.08);
  --bar-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px -4px rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #1A1A1D;
    --bg-alt: #202025;
    --surface: #25252B;
    --surface-hover: #2E2E35;
    --surface-active: #383842;
    --border: #2F2F36;
    --border-light: #28282F;
    --border-hover: #3D3D46;
    --text: #EEE9E2;
    --text-secondary: #B5AFA6;
    --text-muted: #9B968E;
    --accent: #4A90F7;
    --brand-logo-blue: #4A90F7;
    --brand-logo-green: #E2E7BF;
    --brand-logo-text: #4A90F7;
    --accent-light: rgba(74, 144, 247, 0.08);
    --accent-glow: rgba(74, 144, 247, 0.10);
    --accent-grad: linear-gradient(135deg, #4A90F7 0%, #2360DA 100%);
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
    --shadow-md: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.25);
    --shadow-lg: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.25);
    --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.13) inset, 0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.25);
    --bar-bg: rgba(26, 26, 29, 0.82);
    --bar-border: rgba(255, 255, 255, 0.08);
    --bar-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px -4px rgba(0, 0, 0, 0.4);
  }
}

/* ==================== BASE ==================== */
* { box-sizing: border-box; margin: 0; padding: 0 }
html {
  -webkit-text-size-adjust: 100%;
  scroll-behavior: smooth;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--border-hover) transparent;
}
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-hover);
  border-radius: 4px;
  border: 1px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
  border: 1px solid transparent;
  background-clip: content-box;
}
body {
  background: radial-gradient(1000px 500px at 50% -80px, var(--accent-light) 0%, transparent 80%), var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
}

body, .share-bar, .group-hero, .cat-hero, .group-notes-card, .bm, .gcard, .bmcard, .share-footer, .share-theme-btn {
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
}

.share-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* LOGO 颜色响应主题切换 (与主站 BrandLogo 同款规范，暗色为粉/绿撞色) */
.brand-logo-blue, .s-b {
  stroke: var(--brand-logo-blue, #122E8A) !important;
  transition: stroke 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.brand-logo-green, .s-g {
  stroke: var(--brand-logo-green, #10B981) !important;
  transition: stroke 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
[data-theme="dark"] .brand-logo-blue, [data-theme="dark"] .s-b { stroke: #4A90F7 !important; }
[data-theme="dark"] .brand-logo-green, [data-theme="dark"] .s-g { stroke: #E2E7BF !important; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .brand-logo-blue, :root:not([data-theme="light"]) .s-b { stroke: #4A90F7 !important; }
  :root:not([data-theme="light"]) .brand-logo-green, :root:not([data-theme="light"]) .s-g { stroke: #E2E7BF !important; }
}

/* ==================== 顶栏 (对齐主站 AppHeader 极微雕质感) ==================== */
.share-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 56px;
  display: flex;
  align-items: center;
  background: var(--bar-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--bar-border);
  box-shadow: var(--bar-shadow);
}
.share-bar-wrap {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.share-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: var(--text);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.3px;
  transition: opacity 0.15s ease, transform 0.2s var(--ease-out);
}
.share-brand:hover {
  opacity: 0.9;
  transform: translateY(-0.5px);
}
.share-logo {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.share-logo svg { width: 100%; height: 100% }
.share-brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
  transition: color 0.25s ease;
}
.share-brand:hover .share-brand-title {
  color: var(--brand-logo-text, var(--accent));
}
.share-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
[data-theme="dark"] .share-badge {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
}
.share-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.share-theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
[data-theme="dark"] .share-theme-btn {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.share-theme-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-sm);
}
.share-theme-btn:active {
  transform: translateY(0);
}
.share-theme-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}
.theme-icon-sun { display: none }
.theme-icon-moon { display: flex; align-items: center; justify-content: center }

[data-theme="dark"] .theme-icon-sun { display: flex; align-items: center; justify-content: center }
[data-theme="dark"] .theme-icon-moon { display: none }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-icon-sun { display: flex; align-items: center; justify-content: center }
  :root:not([data-theme="light"]) .theme-icon-moon { display: none }
}
.cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  border-radius: var(--radius-full);
  background: var(--accent-grad);
  color: var(--text-on-accent, #ffffff);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  text-decoration: none;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.25) inset, 0 3px 10px var(--accent-glow);
  transition: box-shadow 0.2s ease, transform 0.2s var(--ease-out), filter 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.cta:hover {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35) inset, 0 6px 18px var(--accent-glow);
  transform: translateY(-1px);
  filter: brightness(1.04);
}
.cta:active {
  transform: translateY(0) scale(0.98);
}

/* ==================== 主内容容器 ==================== */
.share-container {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 72px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ==================== 图标与首字母通用绝对居中（解决首字母与图标并排Bug） ==================== */
.bm-icon, .group-hero-icon, .cat-hero-icon, .gcard-icon, .bmcard-icon, .bmcard-child-ic, .card-logo, .gic-ic {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
.bm-fb, .hero-fb, .bmcard-fb, .bmc-fb, .card-logo-fb, .card-logo-fallback, .gic-ic-fb {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1;
  background: var(--bg-alt);
  z-index: 1;
  user-select: none;
}
.gic-ic-fb {
  font-size: 10px;
}

[data-theme="dark"] .bm-icon img[src*="github.com"],
[data-theme="dark"] .card-logo img[src*="github.com"],
[data-theme="dark"] .bmcard-icon img[src*="github.com"],
[data-theme="dark"] .gic-ic img[src*="github.com"],
[data-theme="dark"] .card-logo img[src*="notion.so"],
[data-theme="dark"] .card-logo img[src*="vercel.com"],
[data-theme="dark"] .card-logo img[src*="x.com"],
[data-theme="dark"] .card-logo img[src*="apple.com"] {
  filter: invert(0.94) !important;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .bm-icon img[src*="github.com"],
  :root:not([data-theme="light"]) .card-logo img[src*="github.com"],
  :root:not([data-theme="light"]) .bmcard-icon img[src*="github.com"],
  :root:not([data-theme="light"]) .gic-ic img[src*="github.com"],
  :root:not([data-theme="light"]) .card-logo img[src*="notion.so"],
  :root:not([data-theme="light"]) .card-logo img[src*="vercel.com"],
  :root:not([data-theme="light"]) .card-logo img[src*="x.com"],
  :root:not([data-theme="light"]) .card-logo img[src*="apple.com"] {
    filter: invert(0.94) !important;
  }
}

.bm-icon img, .group-hero-icon img, .cat-hero-icon img, .gcard-icon img, .bmcard-icon img, .bmcard-child-ic img, .card-logo img, .gic-ic img {
  position: relative;
  z-index: 2;
  object-fit: contain;
  display: block;
}
/* 图片正常渲染时，纯兄弟选择器隐藏后面的首字母（无需 :has()，100% 浏览器兼容） */
.bm-icon img ~ .bm-fb,
.group-hero-icon img ~ .hero-fb,
.cat-hero-icon img ~ .hero-fb,
.gcard-icon img ~ .hero-fb,
.bmcard-icon img ~ .bmcard-fb,
.bmcard-child-ic img ~ .bmc-fb,
.card-logo img ~ .card-logo-fallback,
.card-logo img ~ .card-logo-fb,
.card-logo img ~ .hero-fb,
.gic-ic img ~ .gic-ic-fb {
  display: none !important;
}
/* 现代浏览器 :has() 双重保险：只要含有未出错的 img，首字母绝对不显示 */
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .card-logo-fallback,
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .card-logo-fb,
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .hero-fb,
.gic-ic:has(img:not(.img-err):not(.gic-ic-img-err)) .gic-ic-fb,
.bm-icon:has(img:not(.img-err):not(.bm-img-err)) .bm-fb {
  display: none !important;
}
/* 图片加载失败时隐藏图片，显示首字母 */
img.img-err, img.bm-img-err, img.hero-img-err, img.bmcard-img-err, img.bmc-img-err, img.card-logo-img-err, img.gic-ic-img-err {
  display: none !important;
}
.bm-icon img.img-err ~ .bm-fb,
.bm-icon img.bm-img-err ~ .bm-fb,
.group-hero-icon img.img-err ~ .hero-fb,
.group-hero-icon img.hero-img-err ~ .hero-fb,
.cat-hero-icon img.img-err ~ .hero-fb,
.cat-hero-icon img.hero-img-err ~ .hero-fb,
.gcard-icon img.img-err ~ .hero-fb,
.gcard-icon img.hero-img-err ~ .hero-fb,
.bmcard-icon img.img-err ~ .bmcard-fb,
.bmcard-icon img.bmcard-img-err ~ .bmcard-fb,
.bmcard-child-ic img.img-err ~ .bmc-fb,
.bmcard-child-ic img.bmc-img-err ~ .bmc-fb,
.card-logo img.img-err ~ .card-logo-fallback,
.card-logo img.card-logo-img-err ~ .card-logo-fallback,
.card-logo img.img-err ~ .card-logo-fb,
.card-logo img.card-logo-img-err ~ .card-logo-fb,
.card-logo img.img-err ~ .hero-fb,
.card-logo img.hero-img-err ~ .hero-fb,
.gic-ic img.img-err ~ .gic-ic-fb,
.gic-ic img.gic-ic-img-err ~ .gic-ic-fb {
  display: flex !important;
}

/* ==================== 方案 B：策展级单体画卷 (Group Canvas) ==================== */
.group-canvas {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
[data-theme="dark"] .group-canvas {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-lg);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-canvas {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-lg);
  }
}

/* 一体化 Header */
.group-canvas .group-hero {
  position: relative;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-light);
  padding: 34px 40px 28px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.group-hero-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
[data-theme="dark"] .group-hero-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.group-hero-icon img {
  width: 36px;
  height: 36px;
}
.group-hero-icon svg {
  width: 32px;
  height: 32px;
  color: var(--accent);
}
.group-hero-icon .hero-fb {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  background: var(--bg-alt);
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}
.group-hero-icon .hero-fb svg {
  width: 32px;
  height: 32px;
  color: var(--accent);
}
.group-hero-info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-hero-title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.group-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.meta-tag {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
  padding: 3px 11px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
[data-theme="dark"] .meta-tag {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
}

/* 一体化画卷主体 */
.group-canvas-body {
  padding: 36px 40px 44px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* 导读笔记区 */
.group-notes-section {
  width: 100%;
}
.group-notes-content {
  width: 100%;
}

/* 导读与书签之间的轻柔分隔线 */
.canvas-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--border-light) 15%, var(--border-light) 85%, transparent 100%);
  margin: 0;
}
.focus-notes {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  word-break: break-word;
}
.focus-notes p { margin: 0.4em 0 }
.focus-notes p:first-child { margin-top: 0 }
.focus-notes p:last-child { margin-bottom: 0 }
.focus-notes strong, .focus-notes b { font-weight: 700 }
.focus-notes mark { background-color: var(--accent-light); color: inherit; padding: 1px 4px; border-radius: 3px }
.focus-notes h1 {
  font-size: 1.45rem;
  font-weight: 700;
  margin: 0.7em 0 0.4em;
  color: var(--text);
  letter-spacing: -0.01em;
}
.focus-notes h2 {
  font-size: 1.22rem;
  font-weight: 650;
  margin: 0.6em 0 0.35em;
  color: var(--text);
}
.focus-notes h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  color: var(--text);
}
.focus-notes ul, .focus-notes ol {
  margin: 0.4em 0;
  padding-left: 1.6rem;
}
.focus-notes ol { list-style: decimal }
.focus-notes ul { list-style: disc }
.focus-notes li { margin: 0.2em 0 }
.focus-notes blockquote {
  border-left: 3px solid var(--border);
  padding: 4px 0 4px 14px;
  color: var(--text-secondary);
  margin: 0.6em 0;
  font-style: normal;
}
.focus-notes code {
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 1.5px 5.5px;
  font-size: 0.88em;
  font-family: var(--font-mono);
  color: var(--text);
}
.focus-notes pre {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}
.focus-notes a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 0.15s ease;
}
.focus-notes a:hover { opacity: 0.8 }
.focus-notes img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  margin: 0.4em 0;
}
.focus-notes hr {
  border: none;
  border-top: 1px solid var(--border-light);
  margin: 1.2em 0;
}

/* 笔记内联书签卡 (group-inline-card) */
.focus-notes a.group-inline-card,
.focus-notes span.group-inline-card,
.focus-notes .group-ref-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 7px;
  margin: 0 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-base);
  background: var(--surface);
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  vertical-align: middle;
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--shadow-xs);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s var(--ease-out);
}
.focus-notes a.group-inline-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  transform: translateY(-1px);
}
.focus-notes .group-inline-card img,
.focus-notes .group-ref-card img,
.focus-notes .group-ref-card svg {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
.focus-notes .group-inline-card img.img-err,
.focus-notes .group-ref-card img.img-err {
  display: none !important;
}
.focus-notes .gic-name {
  color: var(--text);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-notes .gic-domain {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}
.focus-notes .gic-count {
  color: var(--text-muted);
  font-size: 11px;
}
.focus-notes .gic-btn, .focus-notes .gic-remove { display: none }

/* 笔记任务清单 (taskList) */
.focus-notes ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
  margin: 0.5em 0;
}
.focus-notes li[data-type="taskItem"] {
  list-style: none;
  position: relative;
  padding-left: 28px;
  margin: 4px 0;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.focus-notes li[data-type="taskItem"]::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1.5px solid var(--border-hover);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.focus-notes li[data-type="taskItem"]::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5L6.5 11.5L12.5 4.5'/%3E%3C/svg%3E");
  background-position: center;
  background-repeat: no-repeat;
  background-size: 11px 11px;
  transform: scale(0);
  opacity: 0;
  transition: transform 0.15s var(--ease-out), opacity 0.15s ease;
  pointer-events: none;
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::after {
  transform: scale(1);
  opacity: 1;
}
.focus-notes li[data-type="taskItem"] p { margin: 0; line-height: 1.6 }
.focus-notes li[data-type="taskItem"][data-checked="true"] {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* ==================== 收录书签网格 (组分享) ==================== */
.group-bookmarks-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.section-title-icon svg { width: 100%; height: 100% }
.section-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}
.section-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-glow);
  padding: 1.5px 8px;
  border-radius: var(--radius-full);
}

/* 搜索框 */
.bm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 240px;
  width: 100%;
  margin-left: auto;
}
/* 书签区右侧工具：复制全部链接 + 搜索 */
.section-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: 0 1 auto;
}
.section-tools .bm-search-wrap { margin-left: 0; width: 240px }
.bm-copy-all {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-glow);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color .15s ease, border-color .15s ease;
}
.bm-copy-all:hover { border-color: var(--accent) }
.bm-copy-all.done { color: #fff; background: var(--accent); border-color: var(--accent) }
.bm-copy-all[hidden] { display: none }
.bm-search-input {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 10px;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) inset;
  font-size: 12.5px;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.bm-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.bm-search-input::placeholder {
  color: var(--text-muted);
}
.bm-search-icon {
  position: absolute;
  right: 9px;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bm-search-icon svg { width: 100%; height: 100% }

.bm-empty-search {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}

.bm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  width: 100%;
}

/* 单条书签行 (组内卡片) */
.bm {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s var(--ease-out), background-color 0.2s ease;
  position: relative;
  overflow: hidden;
}
[data-theme="dark"] .bm {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .bm {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.bm:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-2px);
}
[data-theme="dark"] .bm:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .bm:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
}
.bm:active { transform: translateY(0) }
.bm-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.bm-icon {
  width: 38px;
  height: 38px;
}
.bm-icon img {
  width: 24px;
  height: 24px;
}
.bm-fb {
  font-size: 14px;
}
.bm-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bm-title {
  display: block;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.bm:hover .bm-title {
  color: var(--accent);
}
.bm-url {
  display: block;
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm-notes {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bm-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.4;
  transform: translate(-2px, 2px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
  margin-left: auto;
  align-self: center;
}
.bm-arrow svg { width: 15px; height: 15px; display: block }
.bm:hover .bm-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--accent);
}
.bm.is-child {
  margin-left: 16px;
  position: relative;
}
.bm.is-child::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: var(--border-hover);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
  padding: 36px 0;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
}

/* ==================== 分类分享 HERO (紧凑对齐主站顶栏与 FilterBar 尺度) ==================== */
.cat-hero {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 20px;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
[data-theme="dark"] .cat-hero {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.cat-hero-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.cat-hero-accent {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--accent-grad);
}
.cat-hero-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  color: var(--accent);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.6) inset;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
[data-theme="dark"] .cat-hero-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}
.cat-hero-icon img { width: 24px; height: 24px; object-fit: contain }
.cat-hero-icon .hero-fb { font-size: 16px }
.cat-hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.cat-hero-name {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.cat-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.cat-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  display: inline-block;
  flex-shrink: 0;
  margin-right: 6px;
}
.cat-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 布局切换器 (三布局按钮，对齐主站 FilterBar) */
.cat-layout-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) inset;
  border-radius: var(--radius-md);
}
.cat-layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.cat-layout-btn:hover { color: var(--text) }
.cat-layout-btn.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
}
[data-theme="dark"] .cat-layout-btn.active {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.cat-layout-btn svg { width: 16px; height: 16px; display: block }
@media (max-width: 768px) { .cat-layout-btn.hide-mobile { display: none } }

/* ==================== CARD GRID (对齐主站 cards.css / layout.css) ==================== */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  /* 同一行等高（按该行最高卡片），不同行按内容自适应，避免只有链接的卡片大片留白 */
  align-items: stretch;
}
.card-grid .card-list-inner {
  display: contents;
}

/* 卡片基类 */
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 16px 10px;
  cursor: pointer;
  transition: box-shadow 0.3s var(--ease-out), border-color 0.2s ease, transform 0.3s var(--ease-out), background-color 0.2s ease;
  overflow: hidden;
  max-height: 232px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
}
[data-theme="dark"] .card {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .card {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.card:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-3px);
}
[data-theme="dark"] .card:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .card:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
}
.card:active {
  transform: translateY(0) scale(0.995);
  transition-duration: 0.08s;
}

/* 点击热区覆盖层：卡片整体点击直达外链或聚焦 */
.card-link-overlay, .card-focus-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  text-decoration: none;
  border-radius: var(--radius-lg);
}

/* 组卡片左边缘光晕竖条 */
.group-card {
  position: relative;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  padding: 16px 16px 10px;
  max-height: 232px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
}
[data-theme="dark"] .group-card {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-card {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.group-card:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-3px);
}
[data-theme="dark"] .group-card:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-card:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
}
.group-card-accent {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--accent-grad);
  opacity: 0.5;
  border-radius: 0 2px 2px 0;
  transition: opacity 0.2s ease, box-shadow 0.2s ease;
}
.group-card:hover .group-card-accent {
  opacity: 0.8;
  box-shadow: 0 0 8px var(--accent-glow);
}

/* 卡片顶行 */
.card-topline {
  flex-shrink: 0;
  z-index: 1;
  background: var(--surface);
}
.card-toprow, .group-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 5px;
}
.card-logo {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s ease, transform 0.25s var(--ease-out), box-shadow 0.2s ease;
}
.card-logo img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.card-logo svg {
  width: 24px;
  height: 24px;
  color: var(--accent);
}
.card-logo-fallback, .hero-fb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
}
.gic-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 2px;
}
.gic-ic img {
  width: 16px;
  height: 16px;
  border-radius: 2px;
  object-fit: contain;
}
.card:hover .card-logo {
  border-color: var(--accent);
  transform: scale(1.08);
  box-shadow: 0 2px 8px var(--accent-glow);
}

.card-titlewrap {
  flex: 1;
  min-width: 0;
  height: 38px;
  overflow: hidden;
  padding: 0 4px;
  margin: 0 -4px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}
.card-titlewrap-text {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}
.card-name {
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 18px;
  height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  transition: color 0.15s ease;
}
.card:hover .card-name {
  color: var(--accent);
}
.card-domain {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
  height: 18px;
  margin: 0;
}
.group-domain { display: none }
.mini-domain { display: none }
.card-open-hint {
  flex-shrink: 0;
  display: none;
  width: 14px;
  height: 14px;
  color: var(--accent);
  opacity: 0.85;
}
.card-open-hint svg { width: 14px; height: 14px; display: block }
.card:hover .card-open-hint { display: block }

/* 卡片正文与内容区 */
.card-body {
  position: relative;
  z-index: 3;
  pointer-events: none;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scrollbar-width: thin;
}
.card-body a,
.card-body .sub-sites {
  pointer-events: auto;
}
.grp-scroll-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.card-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scrollbar-width: thin;
}
.card-notes {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.group-body {
  overflow: visible;
  padding: 4px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.card-grid:not(.list-view) .grp-scroll-body .group-body {
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
}
.card-preview { display: none }

/* 散落书签子站点网格 */
.sub-sites {
  position: relative;
  z-index: 4;
  margin-top: 8px;
  border-top: 1px solid var(--border-light);
  padding-top: 6px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 4px;
}
.sub-sites .group-inline-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sub-sites .group-inline-card:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
}
.sub-sites .group-inline-card img { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0 }
.sub-sites .group-inline-card .gic-ic { display: flex; align-items: center; }
.sub-sites .group-inline-card .gic-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;
}

/* 卡片底部 */
.card-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
  background: var(--surface);
  transition: border-color 0.2s ease;
}
.card:hover .card-foot { border-color: var(--border-hover); }
.card-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--text-muted);
  cursor: default;
}
.card-stat svg { width: 12px; height: 12px }

/* ==================== 布局模式：列表视图 (List View) ==================== */
.card-grid.list-view {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  grid-template-columns: none !important;
  align-items: stretch !important;
  width: 100% !important;
}
.card-grid.list-view .card-list-inner {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  width: 100% !important;
}
.card-grid.list-view .card,
.card-grid.list-view .group-card {
  width: 100% !important;
  box-sizing: border-box !important;
  height: 82px !important;
  min-height: 0 !important;
  padding: 8px 16px !important;
  flex-direction: column !important;
  justify-content: center !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-card) !important;
}
.card-grid.list-view .card:hover,
.card-grid.list-view .group-card:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.card-grid.list-view .card-topline {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  background: transparent !important;
  width: 100% !important;
}
.card-grid.list-view .card-toprow,
.card-grid.list-view .group-card-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  margin: 0 !important;
  flex: 1 !important;
  min-width: 0 !important;
  width: 100% !important;
}
.card-grid.list-view .card-logo { width: 36px !important; height: 36px !important; flex-shrink: 0 !important; }
.card-grid.list-view .card-logo img { width: 22px !important; height: 22px !important; }
.card-grid.list-view .card-logo svg { width: 20px !important; height: 20px !important; }
.card-grid.list-view .card-titlewrap { height: 36px !important; flex: 1 !important; min-width: 0 !important; }
.card-grid.list-view .card-name { font-size: 0.88rem !important; }
.card-grid.list-view .card-domain { font-size: 0.75rem !important; margin-left: 6px !important; }
.card-grid.list-view .card-body {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  width: 100% !important;
}
.card-grid.list-view .card-body .focus-notes,
.card-grid.list-view .card-body .sub-sites {
  display: none !important;
}
.card-grid.list-view .card:has(.sub-sites) {
  height: auto !important;
  max-height: none !important;
  min-height: 82px !important;
  padding: 10px 16px !important;
}
.card-grid.list-view .card:has(.sub-sites) .card-body {
  overflow: visible !important;
}
.card-grid.list-view .card:has(.sub-sites) .card-body .sub-sites {
  display: flex !important;
  flex-wrap: wrap !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}
.card-grid.list-view .card-foot {
  position: absolute !important;
  top: 10px !important;
  right: 14px !important;
  padding: 0 !important;
  border-top: none !important;
  background: transparent !important;
  margin: 0 !important;
  z-index: 3 !important;
}
.card-grid.list-view .card-preview {
  display: block !important;
  font-size: 0.82rem !important;
  color: var(--text-muted) !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 85% !important;
  margin-top: 2px !important;
  line-height: 1.4 !important;
}

/* ==================== 移动端默认列表视图 (防首屏宫格闪烁) ==================== */
.share-mobile-list .cat-grid:not(.mini-grid-view) {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  grid-template-columns: none !important;
  align-items: stretch !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-list-inner {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card {
  width: 100% !important;
  box-sizing: border-box !important;
  height: 82px !important;
  min-height: 0 !important;
  padding: 8px 16px !important;
  flex-direction: column !important;
  justify-content: center !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-card) !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:hover,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-topline {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  background: transparent !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-toprow,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  margin: 0 !important;
  flex: 1 !important;
  min-width: 0 !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo { width: 36px !important; height: 36px !important; flex-shrink: 0 !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo img { width: 22px !important; height: 22px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo svg { width: 20px !important; height: 20px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-titlewrap { height: 36px !important; flex: 1 !important; min-width: 0 !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-name { font-size: 0.88rem !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-domain { font-size: 0.75rem !important; margin-left: 6px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body .focus-notes,
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body .sub-sites {
  display: none !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) {
  height: auto !important;
  max-height: none !important;
  min-height: 82px !important;
  padding: 10px 16px !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) .card-body {
  overflow: visible !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) .card-body .sub-sites {
  display: flex !important;
  flex-wrap: wrap !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-foot {
  position: absolute !important;
  top: 10px !important;
  right: 14px !important;
  padding: 0 !important;
  border-top: none !important;
  background: transparent !important;
  margin: 0 !important;
  z-index: 3 !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-preview {
  display: block !important;
  font-size: 0.82rem !important;
  color: var(--text-muted) !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 85% !important;
  margin-top: 2px !important;
  line-height: 1.4 !important;
}
.share-mobile-list .cat-layout-btn.hide-mobile,
.share-mobile-list .cat-layout-btn[data-layout="grid"] {
  display: none !important;
}
.share-mobile-list .cat-layout-btn[data-layout="list"] {
  background: var(--surface) !important;
  color: var(--accent) !important;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs) !important;
}
[data-theme="dark"] .share-mobile-list .cat-layout-btn[data-layout="list"] {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs) !important;
}

/* ==================== 布局模式：小宫格视图 (Mini-Grid View) ==================== */
.card-grid.mini-grid-view {
  display: block !important;
  column-gap: 10px !important;
  column-fill: balance !important;
  column-width: clamp(140px, 11vw, 200px) !important;
}
.card-grid.mini-grid-view .card,
.card-grid.mini-grid-view .group-card {
  break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
  display: block !important;
  width: 100% !important;
  height: auto !important;
  max-height: none !important;
  margin: 0 0 10px !important;
  padding: 8px 10px !important;
  border-radius: var(--radius-md) !important;
  box-shadow: var(--shadow-card) !important;
}
.card-grid.mini-grid-view .card-toprow,
.card-grid.mini-grid-view .group-card-head {
  gap: 6px !important;
  align-items: center !important;
  margin-bottom: 2px !important;
}
.card-grid.mini-grid-view .card-logo { width: 20px !important; height: 20px !important; border-radius: var(--radius-sm) !important; }
.card-grid.mini-grid-view .card-logo img { width: 16px !important; height: 16px !important; }
.card-grid.mini-grid-view .card-logo-fallback,
.card-grid.mini-grid-view .hero-fb { font-size: 0.7rem !important; width: 16px !important; height: 16px !important; }
.card-grid.mini-grid-view .card-titlewrap { height: 20px !important; }
.card-grid.mini-grid-view .card-name { font-size: 13px !important; height: 20px !important; line-height: 20px !important; }
.card-grid.mini-grid-view .card-titlewrap .card-domain { display: none !important; }
.card-grid.mini-grid-view .mini-domain {
  display: block !important;
  font-size: 10px !important;
  opacity: 0.6 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  margin-top: 2px !important;
  font-family: var(--font-mono) !important;
}
.card-grid.mini-grid-view .card-body {
  display: block !important;
  padding: 0 !important;
  margin-top: 4px !important;
}
.card-grid.mini-grid-view .card-notes,
.card-grid.mini-grid-view .group-body,
.card-grid.mini-grid-view .sub-sites { display: none !important; }
.card-grid.mini-grid-view .card-preview {
  display: -webkit-box !important;
  -webkit-line-clamp: 4 !important;
  line-clamp: 4 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  color: var(--text-muted) !important;
}
.card-grid.mini-grid-view .card-foot {
  padding: 4px 0 0 !important;
  margin-top: 4px !important;
  border-top: 1px solid var(--border-light) !important;
}
.card-grid.mini-grid-view .card-stat { font-size: 10.5px !important; opacity: 0.8 !important; }

/* ==================== 组聚焦模式 (Focus Mode，100% 对齐主站) ==================== */
.group-focus-panel {
  display: none;
}
.group-focus-panel:target {
  display: flex !important;
  flex-direction: column;
  gap: 14px;
  animation: cardIn 0.28s var(--ease-out);
}
body:has(.group-focus-panel:target) .cat-hero {
  display: none !important;
}
body:has(.group-focus-panel:target) #cardGrid {
  display: none !important;
}

.focus-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 0 6px;
}
.exit-focus-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: all 0.15s ease;
  box-shadow: var(--shadow-xs);
}
.exit-focus-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-light);
}
.exit-focus-btn svg { width: 14px; height: 14px; }
.focus-bar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.focus-bar .panel-count {
  font-size: 12px;
  color: var(--text-muted);
}

.group-card-focus {
  height: auto !important;
  max-height: none !important;
  min-height: 200px !important;
  padding: 20px 24px 24px !important;
  cursor: default !important;
  box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-card-hover) !important;
  border-color: var(--accent) !important;
}
.group-card-focus .group-card-accent {
  opacity: 1 !important;
}
.group-card-focus .card-titlewrap {
  cursor: default !important;
}
.group-card-focus .card-titlewrap:hover {
  background: transparent !important;
}
.group-card-focus .card-titlewrap:hover .card-name {
  color: var(--text) !important;
}
.group-card-focus .card-scroll-wrap {
  overflow: visible !important;
}
.group-card-focus .group-body {
  font-size: 14px !important;
  line-height: 1.7 !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}
.group-bookmarks-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
}
/* 组分享页正文里已有 .canvas-divider / 头部底边分隔，书签区不再叠一条上边框 */
.group-canvas-body .group-bookmarks-section {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.group-bookmarks-section .section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.group-bookmarks-section .section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.group-bookmarks-section .section-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

/* ==================== 尾部 FOOTER ==================== */
.share-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-light);
  padding: 48px 24px 36px;
  text-align: center;
}
.share-footer-inner {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.share-footer-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  color: var(--text);
}
.footer-logo {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
}
.footer-logo svg { width: 100%; height: 100% }
.share-footer-slogan {
  font-size: 12.5px;
  color: var(--text-muted);
}
.share-footer-cta {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  margin-top: 2px;
  transition: opacity 0.15s ease;
}
.share-footer-cta:hover {
  opacity: 0.8;
  text-decoration: underline;
}
.share-footer-copy {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}
/* 举报 / 侵权投诉：公网 UGC 必须提供的对外处置通道，弱化但可达 */
.share-footer-report {
  font-size: 11.5px;
  color: var(--text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
  margin-top: 6px;
  transition: color 0.15s ease;
}
.share-footer-report:hover {
  color: var(--accent);
}

/* ==================== 404 / 503 兜底 ==================== */
.nf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 72px 0 40px;
  text-align: center;
}
.nf-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-sm);
  border-radius: 20px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
[data-theme="dark"] .nf-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, var(--shadow-sm);
}
.nf-icon svg { width: 30px; height: 30px }
.nf-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}
.nf-body {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 420px;
}

/* ==================== 响应式适配 ==================== */
@media (max-width: 768px) {
  .share-container {
    padding: 20px 16px 56px;
  }
  .group-canvas .group-hero {
    padding: 24px 22px 20px;
    gap: 16px;
  }
  .group-canvas-body {
    padding: 24px 22px 32px;
    gap: 26px;
  }
}

@media (max-width: 640px) {
  .share-bar-wrap { padding: 0 16px }
  .share-container { padding: 14px 10px 48px; }
  .group-canvas { border-radius: var(--radius-lg); }
  .group-canvas .group-hero { padding: 18px 16px; gap: 14px }
  .group-hero-icon { width: 48px; height: 48px; border-radius: var(--radius-md) }
  .group-hero-icon svg { width: 28px; height: 28px; }
  .group-hero-title { font-size: 21px }
  .group-canvas-body { padding: 18px 16px 24px; gap: 20px }
  .bm-grid { grid-template-columns: 1fr }
  /* 手机上工具条换行占满整行：复制按钮在左、搜索框撑满剩余宽度 */
  .section-tools { flex-basis: 100%; margin-left: 0 }
  .section-tools .bm-search-wrap { flex: 1; width: auto; max-width: none }
}
`
