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
      // CloudBase 契约子集：以下文件均经 Glob 确认真实存在（仓库无 cloudbase*.test.ts /
      // dbApi*.test.ts 命名，故取真实的契约测试）；依赖注入或 vi.mock 了云侧模块，
      // 与 .env 真值解耦，可在 cloudbase 形态下稳定通过。
      // cloudbaseEnvSwitch 是唯一**不 mock 开关本身**的真源断言（双形态共用文件，
      // 在本套件断言 CloudBase 分支、在默认套件断言 Supabase 分支），排在首位。
      include: [
        'src/__tests__/lib/cloudbaseEnvSwitch.test.ts',
        'src/__tests__/composables/syncRemotePort.cloudbase.test.ts',
        'src/__tests__/lib/authDriver.cloudbase.test.ts',
        'src/__tests__/composables/usePurchasePlans.test.ts',
        'src/__tests__/composables/billing-module7-audit-fixes.test.ts',
      ],
    },
  }),
)
