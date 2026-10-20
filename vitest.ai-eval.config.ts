import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * vitest.ai-eval.config.ts — 真模型 golden 回归评测专用配置（`npm run test:ai-eval`）。
 * 与默认 vitest.config.ts 分离：评测手动触发、走真实网络与计费通道，
 * 通过 AI_EVAL_REQUIRE=1 门控开启 ai-golden-eval.test.ts（默认套件中该文件整体跳过）。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/ai-eval/ai-golden-eval.test.ts'],
    // 真实模型逐条串行评测较慢，放宽超时；单条用例另有 120s 级超时保护
    testTimeout: 180000,
    env: {
      AI_EVAL_REQUIRE: '1',
    },
  },
})
