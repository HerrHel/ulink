import { defineConfig, devices } from '@playwright/test'

/** L2 真后端：不注入 mock URL，让 shell / Vite .env 提供真 VITE_SUPABASE_* */
const isL2 = !!process.env.LV_E2E_L2

/**
 * 生产构建模式（npm run test:e2e:prod）：webServer 改为 build + preview，
 * 直接对生产产物跑 e2e——覆盖 PurgeCSS/minify 等仅生产构建生效的回归
 * （dev server 无法复现该类问题）。默认 test:e2e 仍走 dev server 快速迭代。
 */
const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

// 生产模式 preview 用 5174，避开常驻 dev server 占用的 5173；
// dev 模式仍走 5173（vite 默认端口）。
const port = isProd ? 5174 : 5173

// process.env 的值类型是 string | undefined，而 Playwright 的 webServer.env 只接受
// Record<string, string>（含 undefined 既过不了类型检查、运行时还可能注入 "undefined" 字符串）。
// 先收敛成纯字符串表，作为 L1/L2 两种形态共用的底座。
const baseEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
)

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 文件级并行（fullyParallel 保持 false：同文件内用例仍串行，避免文件内状态链断裂）。
  // workers=1 时 37 用例完全串行 ~2min；3 是速度与稳定性的平衡点（机器 CPU 供给有限）。
  workers: 3,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 生产模式：build+preview 起服务（VITE_ 变量经 env 于构建期注入产物）；
    // reuseExistingServer=false 保证测的是刚构建的生产产物，而非被常驻 dev server 顶替。
    command: isProd
      ? `npm run build && npm run preview -- --port ${port} --strictPort`
      : 'npm run dev',
    url: `http://localhost:${port}`,
    // dev 也一律不复用常驻 server：常驻进程可能带开发机 .env.local（VITE_BACKEND=cloudbase 等），
    // 会把本地配置泄漏进 CI；false 强制用下面注入的干净 env 起新进程。
    reuseExistingServer: false,
    timeout: isProd ? 300000 : 120000,
    // L1/dev：显式把 VITE_BACKEND 钉成 ''（Supabase 形态），避免开发机 .env.local 的
    //   VITE_BACKEND=cloudbase 泄漏进 CI；VITE_CLOUDBASE_FN_BASE 同样显式化给假值。
    //   注入 Supabase 假凭证保证 supabase-js 非 null client（请求由 supabaseMock 拦截）。
    //   session mock 按 VITE_BACKEND 分流：Supabase 写 linkvault_auth；切到 cloudbase 形态时
    //   e2e/helpers/supabaseMock.ts 的 installSupabaseMock 改写 credentials_*/tcb_* 键（见该文件）。
    // L2：纯透传真实环境（真后端），不注入任何 mock fallback。
    // prod：与 L2 一样只透传 baseEnv——构建必须读 .env.production（VITE_BACKEND=cloudbase
    //   + 真基址 https://ulink.ren）。此前把 L1 的 VITE_BACKEND:'' 也注入给 prod 构建，
    //   导致「E2E Tests (prod build)」测的是 Supabase 形态 + 假基址，与线上形态相反，
    //   复现不了仅生产构建生效的问题（审计 #7）。CI runner 无 VITE_* 环境变量，
    //   不会覆盖 .env.production；本地跑 prod 模式时也以 .env.production 为准。
    env: isL2 || isProd
      ? baseEnv
      : {
          ...baseEnv,
          VITE_BACKEND: '',
          VITE_CLOUDBASE_FN_BASE: 'https://test.ulink.ren',
          VITE_SUPABASE_URL:
            process.env.VITE_SUPABASE_URL || 'https://l1mock.supabase.co',
          VITE_SUPABASE_ANON_KEY:
            process.env.VITE_SUPABASE_ANON_KEY ||
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImwxbW9jayIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQwOTk1MjAwLCJleHAiOjIwOTk1MTY4MDB9.l1-mock-e2e-key',
        },
  },
})
