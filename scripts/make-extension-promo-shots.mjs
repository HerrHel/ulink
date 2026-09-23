import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.resolve('outputs/store_assets');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // Helper to build simulated Edge browser page
  function buildEdgeFrameHtml(activeTabTitle, activeUrl, sidebarContentHtml) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }
  body { width: 1280px; height: 800px; overflow: hidden; background: #18181B; display: flex; flex-direction: column; color: #E4E4E7; }
  
  /* Edge top bar */
  .edge-top { background: #1F1F23; border-bottom: 1px solid #27272A; display: flex; flex-direction: column; flex-shrink: 0; }
  .edge-tabs { display: flex; align-items: center; padding: 6px 12px 0; gap: 4px; }
  .edge-tab { background: #27272A; border-radius: 8px 8px 0 0; padding: 7px 16px; font-size: 12px; display: flex; align-items: center; gap: 8px; color: #F4F4F5; border: 1px solid #3F3F46; border-bottom: none; max-width: 220px; font-weight: 500; }
  .edge-tab-add { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #A1A1AA; cursor: pointer; border-radius: 6px; }
  .edge-tab-icon { width: 14px; height: 14px; border-radius: 2px; }

  .edge-nav { display: flex; align-items: center; padding: 6px 12px; gap: 10px; background: #18181B; }
  .nav-btns { display: flex; gap: 6px; color: #A1A1AA; font-size: 14px; }
  .nav-btn { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
  .url-bar { flex: 1; height: 32px; background: #27272A; border-radius: 16px; border: 1px solid #3F3F46; display: flex; align-items: center; padding: 0 14px; gap: 8px; font-size: 12.5px; color: #D4D4D8; }
  .url-lock { font-size: 11px; color: #10B981; }
  .url-text { flex: 1; font-family: monospace; font-size: 12px; }
  .url-icons { display: flex; gap: 10px; color: #A1A1AA; font-size: 13px; align-items: center; }
  .ext-icon-badge { width: 22px; height: 22px; border-radius: 5px; background: #C85A32; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 11px; }

  /* Body split: Webpage (left) + Side Panel (right) */
  .edge-body { flex: 1; display: flex; min-height: 0; }
  
  /* Left web page mockup */
  .web-viewport { flex: 1; background: #0D1117; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid #27272A; }
  .web-header { padding: 16px 32px; border-bottom: 1px solid #21262D; display: flex; align-items: center; justify-content: space-between; }
  .web-repo-title { font-size: 18px; font-weight: 600; color: #58A6FF; display: flex; align-items: center; gap: 8px; }
  .web-repo-badge { font-size: 11px; border: 1px solid #30363D; padding: 2px 8px; border-radius: 12px; color: #8B949E; }
  .web-content { padding: 32px; display: flex; flex-direction: column; gap: 20px; color: #C9D1D9; }
  .web-hero-box { background: #161B22; border: 1px solid #30363D; border-radius: 8px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
  .web-h1 { font-size: 22px; font-weight: bold; color: #F0F6FC; }
  .web-p { font-size: 13.5px; line-height: 1.6; color: #8B949E; max-width: 600px; }
  .web-stats { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: #8B949E; }
  .web-file-list { background: #161B22; border: 1px solid #30363D; border-radius: 8px; overflow: hidden; font-size: 12.5px; }
  .web-file-item { padding: 10px 16px; border-bottom: 1px solid #21262D; display: flex; align-items: center; justify-content: space-between; color: #C9D1D9; }

  /* Right Side panel container (width 380px) */
  .sidepanel-wrap { width: 380px; background: #18181B; display: flex; flex-direction: column; flex-shrink: 0; box-shadow: -4px 0 16px rgba(0,0,0,0.3); }
  .sidepanel-header { height: 42px; background: #1F1F23; border-bottom: 1px solid #27272A; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; font-size: 12.5px; font-weight: 600; color: #F4F4F5; }
  .sidepanel-frame-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
</style>
</head>
<body>
  <div class="edge-top">
    <div class="edge-tabs">
      <div class="edge-tab">
        <svg class="edge-tab-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${activeTabTitle}</span>
        <span style="font-size:12px;margin-left:auto;opacity:0.6;">&times;</span>
      </div>
      <div class="edge-tab-add">+</div>
    </div>
    <div class="edge-nav">
      <div class="nav-btns">
        <div class="nav-btn">&#x2190;</div>
        <div class="nav-btn">&#x2192;</div>
        <div class="nav-btn">&#x21bb;</div>
      </div>
      <div class="url-bar">
        <span class="url-lock">&#128274;</span>
        <span class="url-text">${activeUrl}</span>
      </div>
      <div class="url-icons">
        <div class="ext-icon-badge" title="与链 (ulink)">&#x2605;</div>
        <div style="font-size:14px;cursor:pointer;">&#9633;</div>
      </div>
    </div>
  </div>

  <div class="edge-body">
    <!-- Left web page -->
    <div class="web-viewport">
      <div class="web-header">
        <div class="web-repo-title">
          <span>HerrHel / <strong>ulink</strong></span>
          <span class="web-repo-badge">Public</span>
        </div>
        <div style="display:flex;gap:8px;font-size:12px;">
          <span style="background:#21262D;padding:4px 10px;border-radius:6px;border:1px solid #30363D;">Watch 12</span>
          <span style="background:#21262D;padding:4px 10px;border-radius:6px;border:1px solid #30363D;">Fork 24</span>
          <span style="background:#21262D;padding:4px 10px;border-radius:6px;border:1px solid #30363D;color:#E3B341;">&#9733; Star 168</span>
        </div>
      </div>
      <div class="web-content">
        <div class="web-hero-box">
          <div class="web-h1">与链（ulink）— 个人书签管理器与浏览器扩展</div>
          <div class="web-p">极简、高效、安全的单页书签与知识管理系统（Vue 3 + TypeScript + Dexie IDB + Supabase 云同步 + AES-256-GCM 端到端加密）。</div>
          <div class="web-stats">
            <span>&#9679; TypeScript 96.4%</span>
            <span>&#9679; Vue 3.6%</span>
            <span>MIT License</span>
            <span>v1.1.1</span>
          </div>
        </div>
        <div class="web-file-list">
          <div class="web-file-item"><span>&#128194; extension/</span><span style="opacity:0.5">Manifest V3 沉浸式侧边栏扩展</span></div>
          <div class="web-file-item"><span>&#128194; src/</span><span style="opacity:0.5">Web 端主站与核心逻辑</span></div>
          <div class="web-file-item"><span>&#128196; README.md</span><span style="opacity:0.5">与链项目双语文档</span></div>
        </div>
      </div>
    </div>

    <!-- Right Side Panel -->
    <div class="sidepanel-wrap">
      <div class="sidepanel-header">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:#C85A32;font-size:15px;">&#x2605;</span>
          <span>与链 Side Panel</span>
        </div>
        <div style="display:flex;gap:10px;opacity:0.6;font-size:13px;">
          <span>&#9881;</span>
          <span>&times;</span>
        </div>
      </div>
      <div class="sidepanel-frame-body">
        ${sidebarContentHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // --- Screenshot 1: Tab 1 (当前页面详情与一键收藏) ---
  const tab1Html = `
<style>
  .sp-container { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; color: #E4E4E7; }
  .sp-tabs { display: flex; background: #27272A; padding: 3px; border-radius: 8px; border: 1px solid #3F3F46; }
  .sp-tab { flex: 1; text-align: center; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #A1A1AA; font-weight: 500; }
  .sp-tab.active { background: #18181B; color: #F4F4F5; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
  
  .hero-card { background: #27272A; border: 1px solid #3F3F46; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .hero-header { display: flex; gap: 10px; align-items: flex-start; }
  .hero-icon { width: 32px; height: 32px; border-radius: 6px; background: #18181B; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 1px solid #3F3F46; }
  .hero-meta { flex: 1; min-width: 0; }
  .hero-title { font-size: 13.5px; font-weight: 600; color: #FAFAFA; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hero-url { font-size: 11px; color: #A1A1AA; font-family: monospace; margin-top: 2px; }
  .saved-badge { display: inline-flex; align-items: center; gap: 4px; background: #064E3B; color: #34D399; font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 10px; border: 1px solid #059669; }

  .box-section { background: #18181B; border: 1px solid #3F3F46; border-radius: 7px; padding: 9px 11px; display: flex; flex-direction: column; gap: 4px; }
  .box-label { font-size: 10.5px; font-weight: 600; color: #A1A1AA; display: flex; align-items: center; gap: 5px; }
  .box-text { font-size: 12px; line-height: 1.5; color: #E4E4E7; }

  .sub-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
  .sub-chip { background: #27272A; border: 1px solid #3F3F46; border-radius: 5px; padding: 3px 8px; font-size: 11px; color: #D4D4D8; display: inline-flex; align-items: center; gap: 4px; }
  .sub-chip:hover { border-color: #C85A32; color: #C85A32; }

  .action-row { display: flex; gap: 8px; margin-top: 4px; }
  .btn-act { flex: 1; padding: 7px 10px; border-radius: 6px; font-size: 11.5px; font-weight: 500; border: 1px solid #3F3F46; background: #27272A; color: #E4E4E7; text-align: center; cursor: pointer; }
  .btn-act.danger { color: #F87171; border-color: rgba(248,113,113,0.3); }
</style>
<div class="sp-container">
  <div class="sp-tabs">
    <div class="sp-tab active">&#9873; 当前页面</div>
    <div class="sp-tab">&#128218; 书签库 (48)</div>
  </div>

  <div class="hero-card">
    <div class="hero-header">
      <div class="hero-icon">&#128187;</div>
      <div class="hero-meta">
        <div class="hero-title">HerrHel/ulink: 与链书签管理器</div>
        <div class="hero-url">github.com/HerrHel/ulink</div>
      </div>
      <span class="saved-badge">&#10003; 已收藏</span>
    </div>

    <!-- 关联主站备注 -->
    <div class="box-section" style="border-left: 3px solid #C85A32;">
      <div class="box-label" style="color:#C85A32;">&#128221; 主站备注 (GitHub)</div>
      <div class="box-text">全球最大的开源代码托管与协作开发平台，常用工作流与依赖库检索。</div>
    </div>

    <!-- 本页特别备注 -->
    <div class="box-section">
      <div class="box-label">&#128204; 本页特别备注</div>
      <div class="box-text">核心自研项目，单页书签系统与浏览器扩展源码仓库，支持云同步与 E2E 加密。</div>
    </div>

    <!-- 关联子书签 -->
    <div class="box-section">
      <div class="box-label">&#128279; 关联子书签 (3)</div>
      <div class="sub-chips">
        <span class="sub-chip">&#9679; Issues 反馈 ↗</span>
        <span class="sub-chip">&#9679; Releases 发行版 ↗</span>
        <span class="sub-chip">&#9679; Actions 构建 ↗</span>
      </div>
    </div>

    <!-- 密码凭证 -->
    <div class="box-section">
      <div class="box-label">&#128272; 访问凭证 / Token</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
        <span style="font-family:monospace;letter-spacing:2px;color:#A1A1AA;">••••••••••••</span>
        <span style="font-size:11px;color:#C85A32;cursor:pointer;font-weight:600;">显示 &#128065;</span>
      </div>
    </div>

    <div class="action-row">
      <div class="btn-act">&#9998; 编辑备注</div>
      <div class="btn-act">&#128279; 复制链接</div>
      <div class="btn-act danger">&#128465; 删除</div>
    </div>
  </div>
</div>
`;

  const page1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page1.setContent(buildEdgeFrameHtml('HerrHel/ulink: 个人书签管理器', 'https://github.com/HerrHel/ulink', tab1Html));
  await page1.screenshot({ path: path.join(dir, 'screenshot_1280x800_1.png') });
  console.log('Generated screenshot_1280x800_1.png (Side Panel Detail View)');

  // --- Screenshot 2: Tab 2 (书签库检索与多级卡片列表) ---
  const tab2Html = `
<style>
  .sp-container { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: #E4E4E7; }
  .sp-tabs { display: flex; background: #27272A; padding: 3px; border-radius: 8px; border: 1px solid #3F3F46; }
  .sp-tab { flex: 1; text-align: center; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #A1A1AA; font-weight: 500; }
  .sp-tab.active { background: #18181B; color: #F4F4F5; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }

  .search-box { background: #27272A; border: 1px solid #3F3F46; border-radius: 6px; padding: 7px 10px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: #F4F4F5; }
  .search-box input { background: transparent; border: none; color: #F4F4F5; outline: none; flex: 1; font-size: 12px; }

  .cat-bar { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .cat-pill { padding: 3px 9px; border-radius: 12px; font-size: 10.5px; background: #27272A; border: 1px solid #3F3F46; color: #A1A1AA; white-space: nowrap; cursor: pointer; }
  .cat-pill.active { background: #C85A32; border-color: #C85A32; color: #fff; font-weight: 600; }

  .bm-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .bm-card { background: #27272A; border: 1px solid #3F3F46; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .bm-top { display: flex; align-items: center; gap: 9px; }
  .bm-logo { width: 32px; height: 32px; border-radius: 6px; background: #18181B; display: flex; align-items: center; justify-content: center; font-size: 15px; border: 1px solid #3F3F46; flex-shrink: 0; }
  .bm-info { flex: 1; min-width: 0; }
  .bm-title-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .bm-name { font-size: 12.5px; font-weight: 600; color: #FAFAFA; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bm-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .bm-domain { font-size: 10.5px; color: #A1A1AA; font-family: monospace; }
  .bm-cat-tag { font-size: 9.5px; background: #3F3F46; color: #D4D4D8; padding: 1px 5px; border-radius: 4px; }

  .bm-preview { font-size: 11px; color: #A1A1AA; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px dashed #3F3F46; padding-top: 5px; }

  .bm-subs { display: flex; flex-wrap: wrap; gap: 5px; }
  .bm-sub-item { background: #18181B; border: 1px solid #3F3F46; border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #C9D1D9; }
</style>
<div class="sp-container">
  <div class="sp-tabs">
    <div class="sp-tab">&#9873; 当前页面</div>
    <div class="sp-tab active">&#128218; 书签库 (48)</div>
  </div>

  <div class="search-box">
    <span>&#128269;</span>
    <input type="text" placeholder="搜索书签、备注或按拼音..." value="开发">
  </div>

  <div class="cat-bar">
    <span class="cat-pill active">全部 (48)</span>
    <span class="cat-pill">常用开发 (18)</span>
    <span class="cat-pill">设计灵感 (12)</span>
    <span class="cat-pill">日常资讯 (8)</span>
  </div>

  <div class="bm-list">
    <!-- Card 1 -->
    <div class="bm-card">
      <div class="bm-top">
        <div class="bm-logo">&#128187;</div>
        <div class="bm-info">
          <div class="bm-title-row">
            <span class="bm-name">GitHub 开源代码库</span>
            <span style="font-size:11px;color:#A1A1AA;">↗</span>
          </div>
          <div class="bm-meta">
            <span class="bm-domain">github.com</span>
            <span class="bm-cat-tag">常用开发</span>
          </div>
        </div>
      </div>
      <div class="bm-preview">全球最大的开源代码托管与协作平台，包含常用依赖库与工作流。</div>
      <div class="bm-subs">
        <span class="bm-sub-item">HerrHel/ulink ↗</span>
        <span class="bm-sub-item">Trending ↗</span>
      </div>
    </div>

    <!-- Card 2 -->
    <div class="bm-card">
      <div class="bm-top">
        <div class="bm-logo" style="color:#00DC82;">&#9650;</div>
        <div class="bm-info">
          <div class="bm-title-row">
            <span class="bm-name">Supabase Dashboard</span>
            <span style="font-size:11px;color:#A1A1AA;">↗</span>
          </div>
          <div class="bm-meta">
            <span class="bm-domain">supabase.com</span>
            <span class="bm-cat-tag">后端服务</span>
          </div>
        </div>
      </div>
      <div class="bm-preview">云端 Postgres 数据库管理控制台，实时同步与认证后台。</div>
    </div>

    <!-- Card 3 -->
    <div class="bm-card">
      <div class="bm-top">
        <div class="bm-logo" style="color:#FF7262;">&#9670;</div>
        <div class="bm-info">
          <div class="bm-title-row">
            <span class="bm-name">Figma 协同设计</span>
            <span style="font-size:11px;color:#A1A1AA;">↗</span>
          </div>
          <div class="bm-meta">
            <span class="bm-domain">figma.com</span>
            <span class="bm-cat-tag">设计灵感</span>
          </div>
        </div>
      </div>
      <div class="bm-preview">UI 设计画板与设计系统规范，团队在线评审。</div>
    </div>
  </div>
</div>
`;

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page2.setContent(buildEdgeFrameHtml('与链 (ulink) - 书签库侧边栏检索', 'https://developer.mozilla.org/zh-CN/', tab2Html));
  await page2.screenshot({ path: path.join(dir, 'screenshot_1280x800_2.png') });
  console.log('Generated screenshot_1280x800_2.png (Side Panel Library View)');

  await browser.close();
  console.log('Finished generating browser extension promo screenshots!');
})();
