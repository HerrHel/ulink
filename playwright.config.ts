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
    reuseExistingServer: isProd ? false : !process.env.CI,
    timeout: isProd ? 300000 : 120000,
    // 默认 / L1：CI 无 .env 时注入 mock 占位，保证 supabase-js 非 null client，
    // 请求由 e2e/helpers/supabaseMock page.route 拦截。
    // L2：禁止 mock fallback，避免误连 l1mock 或盖住 .env 真项目。
    env: isL2
      ? { ...process.env }
      : {
          ...process.env,
          VITE_SUPABASE_URL:
            process.env.VITE_SUPABASE_URL || 'https://l1mock.supabase.co',
          VITE_SUPABASE_ANON_KEY:
            process.env.VITE_SUPABASE_ANON_KEY ||
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImwxbW9jayIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQwOTk1MjAwLCJleHAiOjIwOTk1MTY4MDB9.l1-mock-e2e-key',
        },
  },
})
