import { defineConfig, Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { PurgeCSS } from 'purgecss';

/* ── 安全 & 缓存 HTTP 响应头 ── */
const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  // S4 短期项：生产 script-src 移除 'unsafe-inline'。
  // 前提已核实：构建产物内无可执行内联 <script>、无原生内联事件（index.html 的
  // 字体 preload onload= 与 main.ts 白屏兜底 onclick= 已改造为非内联形式），
  // PWA SW 注册走外部 /registerSW.js。style-src 仍保留 'unsafe-inline'（Vue 运行
  // 时注入的组件样式 + TipTap 编辑器内联 style 依赖，移除需更大改造，列入中期）。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
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
            const result = await new PurgeCSS().purge({
              content: [
                './index.html',
                './src/**/*.vue',
                './src/**/*.js',
                './src/**/*.ts'
              ],
              css: [{ raw: chunk.source }],
              safelist: {
                standard: [
                  'open', 'show', 'active', 'visible', 'dragging',
                  'card-expanded', 'group-expanded', 'card-selected',
                  'list-item', 'resize-handle', 'no-drag', 'confirm-foot',
                  'cat-sort-list', 'cat-placeholder', 'cat-dragging', 'drag-handle',
                  'resizeLeft', 'resizeRight',
                  'dead-link-badge', 'gfw-blocked-badge',
                  /^modal-/, /^sp-/, /^ctx-/, /^as-/, /^mfb-/,
                  /^vs-/, /^bmp-/, /^attr-/, /^batch-/, /^search-/,
                  /^detail-/, /^rail-/, /^card-/, /^group-/,
                  /^ft-/, /^btn-/, /^form-/, /^check-/,
                  /^toast-/, /^confirm-/, /^dp-/, /^overlay/,
                  /^icon-/, /^flex-/, /^mb-/, /^mt-/, /^pt-/, /^text-/,
                  /^cmd-/, /^ssp-/
                ],
                deep: [/expanded/, /active/, /open/, /show/, /visible/]
              },
              variables: true
            });
            if (result[0] && result[0].css) {
              const originalSize = chunk.source.length;
              const newSize = result[0].css.length;
              if (newSize < originalSize) {
                chunk.source = result[0].css;
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
 * Vite 插件：build 后把已落盘的 dist/index.html 复制为 dist/404.html，
 * 作 GitHub Pages SPA fallback。
 * GitHub Pages 对未知路径命中 404 时返回仓库根 404.html（官方支持），
 * 使 /s/<gid> 等直达路径能自举 SPA：浏览器加载 404.html → main.ts 挂载 →
 * useAppLifecycle.onMounted.detectShareRoute() 解析当前 URL → ShareView 渲染。
 * 注：响应状态码仍为 404（无 SSR 约束下的固有限制），彻底解决需后续 SSR/Functions 轮。
 */
function spa404Plugin(): Plugin {
  return {
    name: 'gh-pages-spa-404-fallback',
    apply: 'build',
    async writeBundle(opts) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const outDir = typeof opts.dir === 'string' ? opts.dir : path.resolve(process.cwd(), 'dist');
      const src = path.join(outDir, 'index.html');
      const dest = path.join(outDir, '404.html');
      try {
        const html = await fs.promises.readFile(src, 'utf8');
        const note = '<!-- GitHub Pages SPA fallback（由 vite spa404Plugin 生成；勿手动编辑）。 -->\n';
        await fs.promises.writeFile(dest, note + html, 'utf8');
        // eslint-disable-next-line no-console
        console.log('[spa404] generated dist/404.html from index.html');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[spa404] failed to generate 404.html:', (e as Error).message);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LinkVault',
        short_name: 'LinkVault',
        description: '个人书签管理器',
        theme_color: '#122E8A',
        background_color: '#F5EFEA',
        display: 'standalone',
        icons: [{
          src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23122E8A" stroke-width="2.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
          sizes: 'any',
          type: 'image/svg+xml'
        }],
        share_target: {
          action: '/',
          method: 'GET',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [{
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
    headersPlugin(),
    spa404Plugin()],
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
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

            // Vue 核心
            if (id.includes('node_modules/vue/') ||
                id.includes('node_modules/@vue/') ||
                id.includes('node_modules/pinia/')) {
              return 'vue-vendor'
            }

            // 其他第三方库（fuse.js, pinyin-pro, nanoid 等）
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