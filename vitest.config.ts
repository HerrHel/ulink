import { defineConfig, UserConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 注入 @vitejs/plugin-vue：vitest 默认不继承 vite.config.ts 的 plugins，
// 缺它则 import *.vue 报 "Failed to parse ... Install @vitejs/plugin-vue"。
// 仅作用 .vue 文件，对纯 ts/js 测无副作用。
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['./src/__tests__/setup.js'],
    // .claude/worktrees/** 兜底排除：长跑 worktree 残留目录（含 node_modules）曾被 vitest 误扫
    // 出 4994 测 4 fail（board-locks 第十轮 A2 段血泪），排除后残留不再污染基线
    exclude: ['e2e/**', 'node_modules/**', 'cli/node_modules/**', '.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'cli/node_modules/',
        'src/__tests__/',
        '**/*.test.js',
        'e2e/',
      ],
    },
  },
})