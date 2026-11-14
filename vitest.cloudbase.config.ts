// CloudBase 后端形态的定向单测配置：默认 vitest.config.ts 把 VITE_BACKEND 钉成 ''，
// 使 isCloudBaseBackend()===true 的分支（edgeFnUrl / dbFrom / dbRpc / getAuthDriver）
// 在 CI 长期零执行。本配置用 mergeConfig 复用默认配置，只覆盖后端开关与云函数基址，
// 并跑一组 CloudBase 契约子集，让这些分支至少在一条独立门禁里被执行。
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // 覆盖默认 ''：让 isCloudBaseBackend() 返回 true，云函数 URL 改走 getCbFnBase()。
      // VITE_PUBLISHABLE_KEY 给假值使 isCloudBaseConfigured=true：cloudbaseEnvSwitch
      // 契约测试里 @cloudbase/js-sdk 被 mock 成 fake，init 不会真连网络，
      // 但要能走到「getCbDb() 返回 rdb builder」这条完整链路（此前无 key → 恒为
      // null client，env 开关之下的真实分支从未执行，见审计 #25）。
      env: {
        VITE_BACKEND: 'cloudbase',
        VITE_CLOUDBASE_FN_BASE: 'https://test.ulink.ren',
        VITE_CLOUDBASE_ENV_ID: 'test-env',
        VITE_PUBLISHABLE_KEY: 'test-publishable-key',
      },
      // #20（审计 2026-11-14）：原 include 硬编码 5 文件，约 5800 测中绝大多数从未
      // 在 cloudbase（生产）形态下跑过。改为按目录覆盖主要测试目录，让
      // isCloudBaseBackend()===true 的分支在更大面上被执行，而非只靠 5 个白名单文件。
      //
      // 为何不直接 src/__tests__/**/*.test.ts 全量：① 默认套件已把同一批测试在
      // Supabase 形态下全量跑过一遍，全量再跑一遍会让 CI 时间翻倍（#20 明确要求
      // 「别让 CI 时间爆炸」）；② ai-eval 真模型评测走 vitest.ai-eval.config.ts
      // 独立门控，不在此重复（其结构性检查已在默认套件常跑，见 #55）。
      // 故取 lib / composables / stores / components 四个主要目录，覆盖后端形态敏感的
      // 绝大多数单测，增量可控。e2e / node_modules / .workbuddy 由 baseConfig.exclude 继承排除。
      include: [
        'src/__tests__/lib/**/*.test.ts',
        'src/__tests__/composables/**/*.test.ts',
        'src/__tests__/stores/**/*.test.ts',
        'src/__tests__/components/**/*.test.ts',
      ],
    },
  }),
)
