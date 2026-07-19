import { defineConfig, devices } from '@playwright/test'

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
    // L1：CI 无 .env 时仍创建真实 supabase-js 客户端（非 null client），
    // 请求由 e2e/helpers/supabaseMock page.route 拦截，无真实出站。
    // 本地已有 .env 时 process.env 优先；未配置则用 mock 占位。
    env: {
      ...process.env,
      VITE_SUPABASE_URL:
        process.env.VITE_SUPABASE_URL || 'https://l1mock.supabase.co',
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImwxbW9jayIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQwOTk1MjAwLCJleHAiOjIwOTk1MTY4MDB9.l1-mock-e2e-key',
    },
  },
})
