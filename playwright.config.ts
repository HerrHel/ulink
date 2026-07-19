import { defineConfig, devices } from '@playwright/test'

/** L2 真后端：不注入 mock URL，让 shell / Vite .env 提供真 VITE_SUPABASE_* */
const isL2 = !!process.env.LV_E2E_L2

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
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
