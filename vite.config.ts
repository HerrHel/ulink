import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { PurgeCSS } from 'purgecss';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pkg from './package.json';
import {
  LEGAL_DOC_SEQUENCE,
  parseLegalDoc,
  renderLegalDocHtml,
  renderLegalIndexHtml,
  slugFromFileName,
} from './src/lib/legal/renderLegalDoc.ts';

/** 以本配置文件为基准解析项目内路径（ESM 无 __dirname） */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* ── 安全 & 缓存 HTTP 响应头 ── */
const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  // S4 短期项：生产 script-src 移除 'unsafe-inline'。
  // 前提已核实：构建产物内无可执行内联 <script>、无原生内联事件（index.html 的
  // 字体 preload onload= 与 main.ts 白屏兜底 onclick= 已改造为非内联形式），
  // PWA SW 注册走外部 /registerSW.js。style-src 仍保留 'unsafe-inline'（Vue 运行
  // 时注入的组件样式 + TipTap 编辑器内联 style 依赖，移除需更大改造，列入中期）。
  //
  // SEC-05 / connect-src 权衡（有意放宽，勿在未改死链策略前收窄）：
  // - 生产 `connect-src 'self' https: wss://*.supabase.co` 允许任意 https fetch。
  // - 原因：客户端死链检查 `checkDirect` 用 no-cors 直连用户书签 URL（任意域名），
  //   以及 favicon/部分外部资源；若改为仅 Edge Function 代检，才可把 connect-src
  //   收到 self + supabase 主机。当前产品选择：弱外泄纵深换本地可达性探测。
  // - XSS 主防线是 script-src 'self'（无 unsafe-inline）；connect 宽只在脚本已失陷时
  //   放大数据外泄面。收紧前先统一死链走 Edge、去掉浏览器直连任意 URL。
  // L1：已记录架构取舍，死链改走 Edge 后收窄 connect-src（去掉 https: 通配）。
  // 勿在未改 checkDirect 前私自收紧，否则死链检测失效。
  // worker-src 'self' blob:：Vite dev/preview client 断线重连时用 blob Worker 做
  // 心跳 ping（waitForSuccessfulPing），未显式声明 worker-src 时回退 script-src
  // （无 blob:）会拦截 → HMR 无法自动恢复。blob worker 脚本源自页面自身同源 JS，
  // 风险可控。生产部署（GitHub Pages 不带 CSP 头）不受影响。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https: wss://*.supabase.co",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; '),
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Vite 插件：为 dev / preview 服务器注入安全 & 缓存头 */
function headersPlugin(): Plugin {
  return {
    name: 'custom-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        // Dev 环境下放宽 script-src 以支持 HMR
        const devCSP = [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "frame-src 'self'",
          // HMR 断线重连的 blob Worker 心跳（waitForSuccessfulPing）必须放行 blob:
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' data: https:",
          "connect-src 'self' ws: wss: https:",
          "font-src 'self' data: https://fonts.gstatic.com",
          "frame-ancestors 'self'",
          "form-action 'self'",
          "base-uri 'self'",
        ].join('; ')
        res.setHeader('Content-Security-Policy', devCSP)
        Object.entries(securityHeaders).forEach(([k, v]) => {
          if (k !== 'Content-Security-Policy') res.setHeader(k, v)
        })
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        Object.entries(securityHeaders).forEach(([k, v]) => res.setHeader(k, v));
        if (/\.html?$/.test(req.url!) || req.url === '/') {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (/\.(js|css|svg|woff2|png|jpg|ico)$/.test(req.url!)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        next();
      });
    },
  };
}

function purgeCssPlugin(): Plugin {
  return {
    name: 'vite-plugin-purgecss',
    async generateBundle(_, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.css')) {
          const chunk = bundle[fileName];
          if (chunk.type === 'asset' && typeof chunk.source === 'string') {
            const raw = chunk.source as string

            // PurgeCSS 8.x 无法正确解析 Vue scoped CSS 的 [data-v-xxxxx]
            // 属性选择器——会将 .foo[data-v-abc] 视为整体而找不到类名 .foo，
            // 导致全部 scoped 样式被误删（issue 复现：AuthModal/SetupGuide 等
            // 异步组件的 CSS 文件被清空为 0 字节）。
            // 解法：剥离 data-v-* hash → PurgeCSS → 恢复 hash 到类/ID 选择器。
            const scopeHashes = new Set<string>()
            const stripped = raw.replace(/\[data-v-[a-f0-9]+\]/g, (m) => {
              scopeHashes.add(m)
              return ''
            })

            const result = await new PurgeCSS().purge({
              content: [
                './index.html',
                './app.html',
                './src/**/*.vue',
                './src/**/*.js',
                './src/**/*.ts'
              ],
              css: [{ raw: stripped }],
              safelist: {
                standard: [
                  'open', 'show', 'active', 'visible', 'dragging',
                  'card-expanded', 'group-expanded', 'card-selected',
                  'list-item', 'resize-handle', 'no-drag', 'confirm-foot',
                  'cat-sort-list', 'cat-placeholder', 'cat-dragging', 'drag-handle',
                  'resizeLeft', 'resizeRight',
                  'dead-link-badge', 'gfw-blocked-badge',
                  // TipTap / ProseMirror 运行时注入的 class
                  'is-editor-empty', 'ProseMirror-selectednode',
                  /^modal-/, /^sp-/, /^settings-/, /^ctx-/, /^as-/, /^mfb-/,
                  /^vs-/, /^bmp-/, /^attr-/, /^batch-/, /^search-/,
                  /^detail-/, /^rail-/, /^card-/, /^group-/,
                  /^ft-/, /^btn-/, /^form-/, /^check-/,
                  /^toast-/, /^confirm-/, /^dp-/, /^overlay/,
                  /^icon-/, /^flex-/, /^mb-/, /^mt-/, /^pt-/, /^text-/,
                  /^cmd-/, /^ssp-/, /^code-/,
                  // Vue Transition 动态生成的 class（name="cpalette"/"drawer"）
                  /^cpalette-/, /^drawer-/,
                  // HistoryPanel diff-* 动态拼接 class
                  /^diff-/,
                  /^brand-logo-/,
                  /^share-/,
                  /^bm/,
                ],
                deep: [/expanded/, /active/, /open/, /show/, /visible/, /view-transition/, /theme-transition/],
                variables: [/^--brand-logo-/]
              },
              variables: true
            })

            if (result[0] && result[0].css) {
              let purged = result[0].css
              // 恢复 data-v-* hash：加回到每个 class / ID 选择器后面
              for (const hash of scopeHashes) {
                purged = purged.replace(
                  /(?<=[}\s,{;]|^)([.#][a-zA-Z_-][\w-]*)/g,
                  `$1${hash}`
                )
              }
              const originalSize = raw.length
              const newSize = purged.length
              if (newSize < originalSize) {
                chunk.source = purged
                console.log(`[PurgeCSS] ${fileName}: ${(originalSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB (${Math.round((1 - newSize/originalSize) * 100)}% reduced)`);
              }
            }
          }
        }
      }
    }
  };
}

/**
 * 2026-08-23 移除：原 spa404Plugin（GitHub Pages SPA fallback，把 index.html 复制为
 * dist/404.html）。托管已迁 Cloudflare Pages——它检测到顶层 404.html 会判定为
 * 非 SPA，导致未知路径返回 404（原生 SPA 支持被关闭）。移除后 dist 无 404.html，
 * Cloudflare 原生 SPA：未知路径自动匹配根 /（200 index.html）。
 * GitHub Pages 已停用（ulink.ren 由 Cloudflare Pages 同域托管），不再需要该插件。
 */

/**
 * 双入口 MPA 路径别名：把 `/app` 重写到 `app.html`，对齐 Cloudflare Pages 的
 * Pretty URL 行为（/app → app.html），dev / preview / e2e 与生产保持同一 URL。
 * dev 下 `/s/*` 无 SSR Function（生产走 Pages Function），同样重写到 app.html，
 * 模拟生产「SSR 壳内接管 SPA」的分享路由环境，e2e 分享用例行为不变。
 * 落地页（index.html）自身位于 /，无需别名。
 */
function mpaAliasPlugin(): Plugin {
  const rewrite = (reqUrl: string | undefined): string | null => {
    if (!reqUrl) return null
    const q = reqUrl.indexOf('?')
    const path = q === -1 ? reqUrl : reqUrl.slice(0, q)
    const rest = q === -1 ? '' : reqUrl.slice(q)
    if (path === '/app' || path === '/app/') return '/app.html' + rest
    if (path.startsWith('/s/')) return '/app.html' + rest
    return null
  };
  const middleware = (req: { url?: string }, _res: unknown, next: () => void) => {
    const rewritten = rewrite(req.url)
    if (rewritten) req.url = rewritten
    next();
  };
  return {
    name: 'mpa-app-alias',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  };
}

/**
 * 法律文档供给：把 docs/legal/*.md 渲染成**带样式的静态页面**并发布
 *
 * 为什么需要：协议、隐私政策、退款政策必须能被用户**直接访问到完整正文**
 * （登录/注册页的入口通常只放链接，监管核查时要求可打开阅读）。
 *
 * 历史问题（2026-10-27 修复）：此前直接把 .md 以 `text/markdown` 抛出，
 * 用户点开看到的是 `## 一、…`、`|---|` 这样未渲染的裸 Markdown（截图实证），
 * 排版完全不可读。现在由 `src/lib/legal/renderLegalDoc.ts` 在构建期渲染为
 * 自包含 HTML（内联 CSS、零 JS），单一真源仍在 docs/legal/，本插件只做供给。
 *
 * 发布产物（多路径并存，保证任何静态托管的裸路径都能命中）：
 * - `legal/<slug>.html`   ← 站内链接使用（显式后缀，不依赖托管的 pretty URL）
 * - `legal/<slug>/index.html` ← `/legal/<slug>` 与 `/legal/<slug>/` 也能打开
 * - `legal/index.html`    ← 索引页
 * - `legal/<slug>.md`     ← 原始 Markdown 保留（便于归档/核查取证，不再对外链接）
 */
function legalDocsPlugin(): Plugin {
  const dir = here('./docs/legal');

  const read = (name: string) => {
    const file = resolve(dir, name);
    // 目录穿越防护：只允许 docs/legal 下的 .md
    if (!file.startsWith(dir) || !name.endsWith('.md')) return null;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };

  const list = () => {
    try {
      // PENDING.md 是内部待办清单（含统一社会信用代码、未填占位、功能缺口），
      // 属于内部管理文件，**不对外发布**。
      return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'PENDING.md');
    } catch {
      return [] as string[];
    }
  };

  /** 全部对外文档，按 LEGAL_DOC_SEQUENCE 排序（其余文档排在后面按文件名） */
  const parseAll = () =>
    list()
      .map((f) => ({ file: f, md: read(f) }))
      .filter((x): x is { file: string; md: string } => x.md !== null)
      .map(({ file, md }) => parseLegalDoc(md, slugFromFileName(file)))
      .sort((a, b) => {
        const ia = LEGAL_DOC_SEQUENCE.indexOf(a.slug as (typeof LEGAL_DOC_SEQUENCE)[number]);
        const ib = LEGAL_DOC_SEQUENCE.indexOf(b.slug as (typeof LEGAL_DOC_SEQUENCE)[number]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.slug.localeCompare(b.slug);
      });

  /** dev / preview 共用的路由：/legal/ 索引、/legal/<slug>[.html|/]、/legal/<name>.md 原文 */
  const middleware = (
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; end: (b: string) => void },
    next: () => void,
  ) => {
    const path = (req.url || '').split('?')[0].split('#')[0];

    // 原始 Markdown（保留可取证入口，不对外链接）
    const mdMatch = /^\/legal\/([\w.-]+\.md)$/.exec(path);
    if (mdMatch) {
      const body = read(mdMatch[1]);
      if (body === null) return next();
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(body);
      return;
    }

    if (path === '/legal' || path === '/legal/' || path === '/legal/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(renderLegalIndexHtml(parseAll()));
      return;
    }

    // /legal/<slug> | /legal/<slug>/ | /legal/<slug>.html
    const pageMatch = /^\/legal\/([\w-]+?)(?:\.html)?\/?$/.exec(path);
    if (pageMatch) {
      const md = read(`${pageMatch[1]}.md`);
      if (md === null) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(renderLegalDocHtml(parseLegalDoc(md, pageMatch[1])));
      return;
    }

    next();
  };

  return {
    name: 'ulink-legal-docs',
    configureServer(server) {
      server.middlewares.use(middleware as never);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware as never);
    },
    generateBundle() {
      const docs = parseAll();
      for (const doc of docs) {
        const html = renderLegalDocHtml(doc);
        const source = read(`${doc.slug}.md`);
        this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}.html`, source: html });
        // 目录形态兜底：某些托管不做扩展名省略，直接按目录默认文档命中
        this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}/index.html`, source: html });
        if (source !== null) {
          this.emitFile({ type: 'asset', fileName: `legal/${doc.slug}.md`, source });
        }
      }
      this.emitFile({ type: 'asset', fileName: 'legal/index.html', source: renderLegalIndexHtml(docs) });
    },
  };
}


/**
 * 本地开发与预览环境网页元数据提取中间件：
 * 突破浏览器跨域限制，在 Vite 服务端直接 fetch 目标网页并提取真实 Title / Description，
 * 保持 dev / preview 与 Cloudflare Pages 边缘端点（functions/api/extract-metadata.ts）一致。
 */
function metadataExtractorPlugin(): Plugin {
  const decodeHtml = (str: string) => {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .trim();
  };

  const decodeHtmlBuffer = (buffer: ArrayBuffer, contentTypeHeader = ''): string => {
    const headerMatch = contentTypeHeader.match(/charset=([a-zA-Z0-9_-]+)/i);
    let charset = headerMatch ? headerMatch[1].toLowerCase() : '';

    const previewSlice = new Uint8Array(buffer.slice(0, 2048));
    let previewStr = '';
    for (let i = 0; i < previewSlice.length; i++) {
      const b = previewSlice[i];
      previewStr += b < 128 ? String.fromCharCode(b) : ' ';
    }

    if (!charset) {
      const metaCharsetMatch =
        previewStr.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
        previewStr.match(/<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i);
      if (metaCharsetMatch) {
        charset = metaCharsetMatch[1].toLowerCase();
      }
    }

    if (charset.includes('gb')) {
      charset = 'gbk';
    } else if (charset.includes('big5')) {
      charset = 'big5';
    } else if (charset.includes('utf-8') || charset.includes('utf8')) {
      charset = 'utf-8';
    }

    try {
      if (charset && charset !== 'utf-8') {
        return new TextDecoder(charset).decode(buffer);
      }
    } catch {}

    const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
    const utf8Str = utf8Decoder.decode(buffer);
    const errorCount = (utf8Str.match(/\uFFFD/g) || []).length;
    if (errorCount > 3) {
      try {
        const gbkStr = new TextDecoder('gbk').decode(buffer);
        if ((gbkStr.match(/\uFFFD/g) || []).length < errorCount) {
          return gbkStr;
        }
      } catch {}
    }
    return utf8Str;
  };

  const handler = async (req: any, res: any, next: any) => {
    const urlPath = (req.url || '').split('?')[0];

    if (urlPath === '/api/ai-candidates') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      let rawBody = '';
      req.on('data', (chunk: any) => { rawBody += chunk.toString(); });
      req.on('end', async () => {
        try {
          const body = JSON.parse(rawBody || '{}');
          const { type, query, targetUrl, targetTitle } = body;

          let mimoKey = process.env.MIMO_API_KEY || '';
          if (!mimoKey) {
            try {
              const rawEnv = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
              const m = rawEnv.match(/MIMO_API_KEY=([^\r\n]+)/);
              if (m) mimoKey = m[1].trim();
            } catch {}
          }

          if (!mimoKey) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: false, error: 'mimo_key_not_configured' }));
          }

          let prompt = '';
          if (type === 'similar') {
            const site = targetTitle ? `${targetTitle} (${targetUrl || ''})` : (targetUrl || '该网站');
            prompt = `你是一个资深互联网工具与高价值软件挖掘专家。\n用户正在寻找与网站【${site}】功能相近、定位相似的优秀同类平台、优质竞品或开源平替工具。\n\n请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。\n要求：\n1. 网站网址必须真实有效（如官方首页地址），严禁捏造或拼接不存在的网址。\n2. 包含高质量同类工具、开源平替、轻量级替代或国内直连产品。\n3. 严禁包含任何 Emoji 表情符号。\n4. 输出合法的 JSON 数组，格式如下：\n[\n  {\n    "title": "工具名称",\n    "url": "https://...",\n    "notes": "20-50字核心功能与特色说明",\n    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",\n    "highlight": "一句话推荐理由"\n  }\n]\n直接输出 JSON，不要任何 Markdown 标记或多余文字。`;
          } else {
            const q = (query || '').trim();
            if (!q) {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              return res.end(JSON.stringify({ success: false, error: 'empty_query' }));
            }
            prompt = `你是一个资深互联网工具与高价值软件挖掘专家。\n用户正在寻找满足特定需求的真实优质网站或在线工具。\n用户需求/意图："${q}"\n\n请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。\n要求：\n1. 网站网址必须真实有效（如官方首页地址），严禁捏造或胡乱拼接不存在的网址。\n2. 针对用户具体意图，精准给出具有代表性的实用工具。\n3. 严禁包含任何 Emoji 表情符号。\n4. 输出合法的 JSON 数组，格式如下：\n[\n  {\n    "title": "工具名称",\n    "url": "https://...",\n    "notes": "20-50字核心功能与特色说明",\n    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",\n    "highlight": "一句话推荐理由"\n  }\n]\n直接输出 JSON，不要任何 Markdown 标记或多余文字。`;
          }

          const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${mimoKey}`,
            },
            body: JSON.stringify({
              model: 'mimo-v2.6-flash',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
              max_tokens: 1000,
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!mimoRes.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: false, error: 'upstream_failed' }));
          }

          const mData = await mimoRes.json() as any;
          const mRaw = mData.choices?.[0]?.message?.content?.trim() || '';
          const mJson = mRaw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
          const items = JSON.parse(mJson);

          if (Array.isArray(items) && items.length > 0) {
            const validItems = items.filter(
              (it: any) => it && typeof it.title === 'string' && typeof it.url === 'string' && it.url.startsWith('http')
            );
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ success: true, items: validItems }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: 'empty_result' }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: err?.message || 'internal_error' }));
        }
      });
      return;
    }

    if (urlPath !== '/api/extract-metadata') return next();

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const onBodyReady = async (rawBody: string) => {
      let targetUrl = '';
      let availableAttributes: Array<{ id: string; name: string }> = [];
      let availableCategories: Array<{ id: string; name: string }> = [];
      try {
        if (req.method === 'POST') {
          const parsed = JSON.parse(rawBody || '{}');
          targetUrl = parsed.url || '';
          if (Array.isArray(parsed.availableAttributes)) {
            availableAttributes = parsed.availableAttributes;
          }
          if (Array.isArray(parsed.availableCategories)) {
            availableCategories = parsed.availableCategories;
          }
        } else {
          const u = new URL(req.url!, 'http://localhost');
          targetUrl = u.searchParams.get('url') || '';
        }
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid_json' }));
        }
        return;
      }

      const clean = (targetUrl || '').trim();
      if (!clean || !/^https?:\/\//i.test(clean)) {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid_url' }));
        }
        return;
      }

      try {
        const u = new URL(clean);
        const h = u.hostname.toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || /^192\.168\./.test(h) || /^10\./.test(h)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'private_ip_forbidden' }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'invalid_url_format' }));
      }

      let title = '';
      let description = '';
      let llmSuggestedCatId: string | undefined = undefined;
      let llmSuggestedAttrs: string[] = [];
      try {
        const tryFetch = async (target: string) => {
          return await fetch(target, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(4000),
            redirect: 'follow',
          });
        };

        let upstream: Response | null = null;
        try {
          upstream = await tryFetch(clean);
        } catch {
          try {
            const parsed = new URL(clean);
            if (!parsed.hostname.startsWith('www.') && parsed.hostname.split('.').length === 2) {
              parsed.hostname = 'www.' + parsed.hostname;
              upstream = await tryFetch(parsed.href);
            }
          } catch {}
        }

        try {
          const contentType = upstream ? upstream.headers.get('content-type') || '' : '';
          if (upstream && upstream.ok && (contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType)) {
            const buf = await upstream.arrayBuffer();
            const html = decodeHtmlBuffer(buf, contentType);
            const headSlice = html.slice(0, 150000);

            const ogTitleMatch =
              headSlice.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
            const tagTitleMatch = headSlice.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (ogTitleMatch && ogTitleMatch[1].trim()) title = decodeHtml(ogTitleMatch[1]);
            else if (tagTitleMatch && tagTitleMatch[1].trim()) title = decodeHtml(tagTitleMatch[1]);

            const descMatch =
              headSlice.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
              headSlice.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
              headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
            if (descMatch && descMatch[1].trim()) description = decodeHtml(descMatch[1]);
          }
        } catch {}

        if (!title && upstream && upstream.ok) {
          const jinaTargets = [clean];
          try {
            const parsed = new URL(clean);
            if (!parsed.hostname.startsWith('www.') && parsed.hostname.split('.').length === 2) {
              jinaTargets.push(`https://www.${parsed.hostname}${parsed.pathname}${parsed.search}`);
            }
          } catch {}

          for (const jt of jinaTargets) {
            try {
              const jinaRes = await fetch(`https://r.jina.ai/${jt}`, {
                headers: { Accept: 'text/plain' },
                signal: AbortSignal.timeout(6000),
              });
              if (jinaRes.ok) {
                const text = await jinaRes.text();
                const tm = text.match(/^Title:\s*(.+)$/im);
                const dm = text.match(/^Description:\s*(.+)$/im);
                if (tm && tm[1].trim()) title = decodeHtml(tm[1].trim());
                if (dm && dm[1].trim()) description = decodeHtml(dm[1].trim());
                else if (!description) {
                  const bodyClean = text
                    .replace(/^Title:.*$/im, '')
                    .replace(/^URL Source:.*$/im, '')
                    .replace(/^Markdown Content:.*$/im, '')
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                    .replace(/[#*`_~>-]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (bodyClean.length > 10) description = bodyClean.slice(0, 160);
                }
                if (title) break;
              }
            } catch {}
          }
        }

        
        // 3. 终极真智能提炼：调用大模型（LLM），将抓取到的原始网页标题与描述深度提炼为
        // 真正的「网站名称」与精炼「备注」（去除SEO关键词堆砌、口号与域名后缀，概括核心业务用途）
        let mimoKey = process.env.MIMO_API_KEY || '';
        if (!mimoKey) {
          try {
            const rawEnv = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
            const m = rawEnv.match(/MIMO_API_KEY=([^\r\n]+)/);
            if (m) mimoKey = m[1].trim();
          } catch {}
        }

        if (mimoKey) {
          try {
            const attrClause = availableAttributes.length > 0
              ? `\n可选属性标签（严格从以下标签中挑选0-3个最匹配的ID数组，没有则填[]）：\n${JSON.stringify(availableAttributes.map(a => ({ id: a.id, name: a.name })))}`
              : '';
            const catClause = availableCategories.length > 0
              ? `\n可选分类列表（严格从以下分类列表中挑选最匹配的一个分类ID，没有把握填null）：\n${JSON.stringify(availableCategories.map(c => ({ id: c.id, name: c.name })))}`
              : '';

            const llmPrompt = `你是一个专业的浏览器书签管理器 AI 整理助手。
用户正在收藏网页：${clean}
${title ? `从该网页抓取到的原始标题：${title}` : ''}
${description ? `从该网页抓取到的原始描述：${description}` : ''}
${attrClause}${catClause}

请根据网址及以上原始信息，为用户智能提炼最地道、规范的书签元数据：
1. "title": 真正的“网站名称”（简洁、地道、纯粹的品牌或产品名，如“4399小游戏”、“GitHub”、“哔哩哔哩”。绝对不要带SEO关键词堆砌、网站后缀、二级域名、营销口号或冗长描述，控制在2-15字内）
2. "description": 真正的“备注”（用一句话精炼概括该网站是什么、核心功能或用途，文雅通顺，20-60字。严禁堆砌游戏名、商品列表或SEO关键词，不要简单复读标题）
3. "suggestedCategoryId": 从可选分类列表中选中的最匹配分类ID（若无可填null）
4. "suggestedAttrIds": 从可选属性标签中挑选0-3个最匹配的ID数组
5. 严禁任何 Emoji 表情符号，输出典雅清晰的纯中文/英文文字。

直接输出合法的JSON，不要任何Markdown或多余文本：
{"title": "站点名称", "description": "一句话精炼简介", "suggestedCategoryId": "分类ID或null", "suggestedAttrIds": []}`;

            const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${mimoKey}`,
              },
              body: JSON.stringify({
                model: 'mimo-v2.6-flash',
                messages: [{ role: 'user', content: llmPrompt }],
                temperature: 0.1,
                max_tokens: 300,
              }),
              signal: AbortSignal.timeout(10000),
            });

            if (mimoRes.ok) {
              const mData = await mimoRes.json();
              const mRaw = mData.choices?.[0]?.message?.content?.trim() || '';
              const mJson = mRaw.replace(/^\`\`\`json\s*/i, '').replace(/^\`\`\`\s*/i, '').replace(/\`\`\`$/i, '').trim();
              const parsed = JSON.parse(mJson);
              if (parsed && parsed.title) {
                title = parsed.title;
                if (parsed.description) description = parsed.description;
                if (parsed.suggestedCategoryId && typeof parsed.suggestedCategoryId === 'string' && parsed.suggestedCategoryId !== 'null') {
                  llmSuggestedCatId = parsed.suggestedCategoryId;
                }
                if (Array.isArray(parsed.suggestedAttrIds)) {
                  llmSuggestedAttrs = parsed.suggestedAttrIds.filter((id: any) => typeof id === 'string');
                }
              }
            }
          } catch {}
        }

        const stripEmojis = (s: string) =>
          s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '').trim();

        title = stripEmojis(title);
        description = stripEmojis(description);

        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(
          JSON.stringify({
            success: Boolean(title || description),
            title: title || undefined,
            description: description || undefined,
            categoryId: llmSuggestedCatId || undefined,
            suggestedAttrIds: llmSuggestedAttrs.length > 0 ? llmSuggestedAttrs : undefined,
            url: clean,
          }),
        );
      } catch (err: any) {
        console.error('[DEBUG metadataExtractor] processRequest error:', err);
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err?.message || 'fetch_error' }));
        }
      }
    };

    if (req.method === 'GET') {
      onBodyReady('');
    } else if (req.readableEnded) {
      onBodyReady('');
    } else {
      let body = '';
      req.on('data', (chunk: Buffer | string) => {
        body += chunk;
        if (body.length > 50000) req.destroy();
      });
      req.on('end', () => onBodyReady(body));
    }
  };

  return {
    name: 'ulink-metadata-extractor',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  define: {
    // 构建时注入版本信息：__BUILD_TIME__ 每次部署必变，设置面板显示以确认线上是否为最新构建
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    legalDocsPlugin(),
    metadataExtractorPlugin(),
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '与链',
        short_name: 'ulink',
        description: '与链（ulink）— 个人书签管理器，支持云同步与端到端加密',
        theme_color: '#122E8A',
        background_color: '#F5EFEA',
        display: 'standalone',
        // 应用主体在 /app（/ 是宣传落地页）：已装 PWA 启动直达应用，不经落地页
        scope: '/',
        start_url: '/app',
        icons: [{
          src: '/logo.svg',
          sizes: 'any',
          type: 'image/svg+xml'
        }],
        share_target: {
          action: '/app',
          method: 'GET',
          // GET 方法唯一合法的 enctype；显式声明可消除 Chromium 的
          // "Enctype should be set to..." manifest 警告
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      workbox: {
        // HTML 不 precache：precache 旧 index.html 会让已装 PWA 的用户在部署后
        // 首刷命中旧版（autoUpdate 需等 SW 换代才切新）。改为导航请求 NetworkFirst
        // （网络优先，离线回退 pages-cache），部署后刷新即拿新 HTML —— 一次刷新即新。
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        // 必须显式覆盖 VitePWA 默认 navigateFallback:"index.html"——HTML 已不 precache，
        // 默认值会让 workbox 生成指向不存在 precache 条目的 NavigationRoute（SW 顶层抛错失效）。
        // 置 undefined 后导航统一走下方 NetworkFirst（网络优先 + pages-cache 离线兜底）。
        navigateFallback: undefined,
        runtimeCaching: [{
          // 导航（页面跳转/刷新）网络优先：网络返回新 HTML 并更新 pages-cache；
          // 网络失败（离线）回退最近缓存的页面。3s 内网络无响应也回退缓存（慢网保护）。
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pages-cache',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 }
          }
        }, {
          urlPattern: /^https:\/\/api\.xinac\.net\/icon\//i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'favicon-cache',
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
          }
        }, {
          urlPattern: /^https:\/\/(api\.fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'font-cache',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
          }
        }]
      }
    }),
    purgeCssPlugin(),
    mpaAliasPlugin(),
    headersPlugin()],
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // 双入口：/ = 宣传落地页（index.html），/app = 应用主体（app.html，
      // Cloudflare Pages Pretty URL 自动映射，dev/preview 由 mpaAliasPlugin 对齐）
      input: {
        landing: here('./index.html'),
        app: here('./app.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // TipTap 核心（必需）
            if (id.includes('node_modules/@tiptap/core') ||
                id.includes('node_modules/@tiptap/pm') ||
                id.includes('node_modules/@tiptap/starter-kit')) {
              return 'tiptap-core'
            }

            // TipTap 扩展（可延迟加载）
            if (id.includes('node_modules/@tiptap/extension-')) {
              return 'tiptap-extensions'
            }

            // ProseMirror（TipTap 底层依赖）
            if (id.includes('node_modules/prosemirror-')) {
              return 'prosemirror'
            }

            // Dexie IndexedDB 封装
            if (id.includes('node_modules/dexie/')) {
              return 'dexie'
            }

            // DOMPurify HTML 净化
            if (id.includes('node_modules/dompurify/')) {
              return 'dompurify'
            }

            // Supabase 客户端（独立 chunk，便于缓存）
            if (id.includes('node_modules/@supabase/')) {
              return 'supabase'
            }

            // fuse.js 模糊搜索（独立 chunk，按需加载）
            if (id.includes('node_modules/fuse.js/')) {
              return 'fuse'
            }

            // pinyin-pro 拼音匹配（独立 chunk，按需加载）
            if (id.includes('node_modules/pinyin-pro/')) {
              return 'pinyin-pro'
            }

            // Vue 核心
            if (id.includes('node_modules/vue/') ||
                id.includes('node_modules/@vue/') ||
                id.includes('node_modules/pinia/')) {
              return 'vue-vendor'
            }

            // 其他第三方库（nanoid 等）
            return 'vendor'
          }
        }
      }
    }
  },
  server: {
    open: true,
  },
  preview: {},
});