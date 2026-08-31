import { defineConfig, UserConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 注入 @vitejs/plugin-vue：vitest 默认不继承 vite.config.ts 的 plugins，
// 缺它则 import *.vue 报 "Failed to parse ... Install @vitejs/plugin-vue"。
// 仅作用 .vue 文件，对纯 ts/js 测无副作用。
export default defineConfig({
  // 允许测试 import functions/_lib/（SSR 共享纯函数，无运行时依赖）。
  // 默认 vite fs.allow 不含 functions/，否则 SSR 测试会被 import-analysis 拒绝。
  server: { fs: { allow: ['./functions'] } },
  resolve: {
    alias: [
      // 让 vitest 看到 SSR 共享纯函数模块（Node ESM 解析 .ts 时不自动 .js → .ts，
      // 这里把 functions/_lib/* 显式映射到 .ts，避免 vite import-analysis 拒绝）
      {
        find: /.*functions[\\/]_lib[\\/]([^\\/]+)\.js$/,
        replacement: fileURLToPath(new URL('./functions/_lib/$1.ts', import.meta.url)),
      },
    ],
  },
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
    setupFiles: ['./src/__tests__/setup.js'],
    // .claude/worktrees/** 兜底排除：长跑 worktree 残留目录（含 node_modules）曾被 vitest 误扫
    // 出 4994 测 4 fail（board-locks 第十轮 A2 段血泪），排除后残留不再污染基线
    // .workbuddy/** 兜底排除：该目录存的是会话备份（含 .vue/.test.ts 副本），
    // 曾被 vitest 误扫成 259 文件中的第 3 个失败项，污染基线
    exclude: ['e2e/**', 'node_modules/**', 'cli/node_modules/**', '.claude/worktrees/**', '.workbuddy/**'],
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