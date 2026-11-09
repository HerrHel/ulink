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
      // 未配 VITE_PUBLISHABLE_KEY → isCloudBaseConfigured=false，客户端优雅降级为 null client，
      // 子集用例全部走注入/mock，不会真连网络。
      env: {
        VITE_BACKEND: 'cloudbase',
        VITE_CLOUDBASE_FN_BASE: 'https://test.ulink.ren',
        VITE_CLOUDBASE_ENV_ID: 'test-env',
      },
      // CloudBase 契约子集：以下文件均经 Glob 确认真实存在（仓库无 cloudbase*.test.ts /
      // dbApi*.test.ts 命名，故取真实的契约测试）；依赖注入或 vi.mock 了云侧模块，
      // 与 .env 真值解耦，可在 cloudbase 形态下稳定通过。
      include: [
        'src/__tests__/composables/syncRemotePort.cloudbase.test.ts',
        'src/__tests__/lib/authDriver.cloudbase.test.ts',
        'src/__tests__/composables/usePurchasePlans.test.ts',
        'src/__tests__/composables/billing-module7-audit-fixes.test.ts',
      ],
    },
  }),
)
