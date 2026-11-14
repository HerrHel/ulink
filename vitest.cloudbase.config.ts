// CloudBase 后端形态的定向单测配置：默认 vitest.config.ts 把 VITE_BACKEND 钉成 ''，
// 使 isCloudBaseBackend()===true 的分支（edgeFnUrl / dbFrom / dbRpc / getAuthDriver /
// invokeCbFunction）在默认套件里长期零执行。本配置用 mergeConfig 复用默认配置，
// 只覆盖后端开关与云函数基址，然后把**整个单测集**在 CloudBase 形态下再跑一遍。
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // 覆盖默认 ''：让 isCloudBaseBackend() 返回 true，云函数 URL 改走 getCbFnBase()。
      // VITE_PUBLISHABLE_KEY 给假值使 isCloudBaseConfigured=true：cloudbaseEnvSwitch
      // 契约测试里 @cloudbase/js-sdk 被 mock 成 fake，init 不会真连网络，
      // 但要能走到「getCbDb() 返回 rdb builder」这条完整链路。
      env: {
        VITE_BACKEND: 'cloudbase',
        VITE_CLOUDBASE_FN_BASE: 'https://test.ulink.ren',
        VITE_CLOUDBASE_ENV_ID: 'test-env',
        VITE_PUBLISHABLE_KEY: 'test-publishable-key',
      },
      // #20（审计 2026-11-14）：原实现只跑白名单里 7 个文件 / 76 条测试，
      // 生产形态（CloudBase）几乎等于没测。2026-11-14 第二轮改为**全量 + 显式排除**：
      //   - 新增测试文件默认就会在两种后端形态下各跑一遍，不会再出现「写完只在
      //     Supabase 形态下验证过」的盲区；
      //   - 确实只能单形态的，必须列进下面 exclude 并写清原因（把缺口写在明处，
      //     而不是靠白名单悄悄不跑）。
      // 覆盖收益：7 文件 / 76 测 → 约 395 文件 / 5900 测在云形态下执行。
      include: ['src/__tests__/**/*.test.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        // ── 以下 6 个文件是「Supabase 形态专用」，不做双形态 ──
        // 它们 mock 的是 supabase.auth 的会话形状 / supabase.channel 的实时通道 /
        // supabase.from 的特定链式返回，CloudBase 形态下走的是完全另一套实现
        // （AuthDriver、realtime 降级 60s 轮询、rdb builder），断言必然错位。
        // 改造成本高于收益，且对应能力在云形态下另有覆盖：
        //   · 认证：lib/authDriver.cloudbase.test.ts、lib/cloudbaseEnvSwitch.test.ts
        //   · 实时：云形态本就是轮询降级，无 subscribe 路径
        'src/__tests__/stores/auth.test.ts',
        'src/__tests__/stores/auth-lifecycle.test.ts',
        'src/__tests__/composables/security-module4-audit-fixes.test.ts',
        'src/__tests__/composables/sync-module3-audit-fixes.test.ts',
        'src/__tests__/composables/useSyncRealtime-subscribe.test.ts',
        'src/__tests__/lib/videoExtract.test.ts',
      ],
    },
  }),
)
