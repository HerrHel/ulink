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
    // 后端开关必须在测试里钉死：`VITE_BACKEND=cloudbase` 是开发/线上用的运行时开关，
    // 一旦写进 .env.local 就会被 vitest 一起读进来，导致单测默认走 CloudBase 驱动、
    // 与既有的 supabase mock 全部对不上（实测 16 个用例瞬间转红）。
    // 默认空 = 走 Supabase 分支；要测 CloudBase 分支的用例直接 createCloudBaseAuthDriver 注入。
    env: { VITE_BACKEND: '' },
    // 默认 5s 对真实 PBKDF2（600K 迭代）× 多次派生的重测试过紧：低核/高负载机器上
    // 4s 级用例（useVault resetVaultWithRecoveryKey / forkPublicGroup 等）偶发超时红，
    // 且 stash 对照实验证明与改动无关（基线同样抖）。放宽到 30s 消除该类调度抖动。
    testTimeout: 30000,
    // 全量套件固定 8 并发：32 核机器默认并发（~16 worker）曾触发「worker 启动超时」
    // 环境 flake，此前靠 CLI 临时降 maxWorkers=2 绕开但全量拖慢到 ~6min。
    // 同子集控制变量实测（2026-10-20）：8 worker 34.8s vs 2 worker 72.8s（2.1x），
    // threads/forks 同速；8 并发下每文件固定开销摊薄膨胀 ~1.9x 但总吞吐净赚。
    // 机器纯 CPU 供给约 3-4 核是天花板，改动此值需全量复跑两轮验证 flake 不复现。
    maxWorkers: 8,
    // .claude/worktrees/** 兜底排除：长跑 worktree 残留目录（含 node_modules）曾被 vitest 误扫
    // 出 4994 测 4 fail（board-locks 第十轮 A2 段血泪），排除后残留不再污染基线
    // .workbuddy/** 兜底排除：该目录存的是会话备份（含 .vue/.test.ts 副本），
    // 曾被 vitest 误扫成 259 文件中的第 3 个失败项，污染基线
    // **/node_modules/** 递归排除：根级 node_modules 之外，cloudbase/functions/<fn>/node_modules
    // 是各云函数自带的依赖目录（构建期 --bundle 用，CI 不安装），其中 core-js-pure 自带
    // 名为 es.regexp.test.js 的源文件，会被当成测试文件扫出「7 个 suite 失败」——
    // 本地基线因此长期红、而 CI 绿，两边结论对不上。用 ** 一次覆盖所有层级。
    exclude: ['e2e/**', '**/node_modules/**', '.claude/worktrees/**', '.workbuddy/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/',
        'src/__tests__/',
        '**/*.test.js',
        'e2e/',
      ],
    },
  },
})