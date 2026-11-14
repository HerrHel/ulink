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
      // #20（审计 2026-11-14）第一版把 include 扩到 lib/composables/stores/components
      // 四个目录，CI 实测 21 个文件 / 117 条失败：这些测试大量直接 mock 了
      // supabase.auth / supabase.from 的返回形状，在 VITE_BACKEND=cloudbase 下走的是
      // 另一条驱动分支，断言必然错位。它们不是「双形态测试」，而是 Supabase 形态专用。
      //
      // 因此保持精确清单：只跑**明确按双形态写**（不依赖 supabase mock 形状）的文件。
      // 想真正扩面需要逐个把测试改造成双形态，属独立工程，不在本次范围。
      include: [
        'src/__tests__/lib/cloudbaseEnvSwitch.test.ts',
        'src/__tests__/lib/authDriver.cloudbase.test.ts',
        'src/__tests__/lib/authDriver.race.test.ts',
        'src/__tests__/composables/syncRemotePort.cloudbase.test.ts',
        'src/__tests__/composables/syncDataIntegrity-audit.test.ts',
        'src/__tests__/composables/usePurchasePlans.test.ts',
        'src/__tests__/composables/billing-module7-audit-fixes.test.ts',
      ],
    },
  }),
)
