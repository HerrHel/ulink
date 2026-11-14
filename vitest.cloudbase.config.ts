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
        // 2026-11-14 晚：原先排除的 6 个「Supabase 形态专用」文件已全部改造为双形态，
        // 排除清单清空。改法（供后续参考）：
        //   · 端点断言只断函数名尾段，或直接与生产同一个 URL 构造器（edgeFnUrl）比对；
        //   · 数据访问 mock 到 lib/dbApi（dbFrom/dbRpc）这一抽象层，两种形态共用同一桩；
        //   · 调用通道 mock 到 lib/cloudbase 的 invokeCbFunction（与 functions.invoke 同形）；
        //   · 认证类用例把驱动钉在 createSupabaseAuthDriver()：它测的是 store 逻辑，
        //     与后端无关，断言强度不变（CloudBase 驱动由 authDriver.cloudbase 专项覆盖）；
        //   · 契约本身不同的（如 realtime 通道 vs 60s 轮询降级）用 it.runIf/skipIf 分成
        //     两条断言，各自锁各自真实行为，而不是整文件跳过。
        // 若将来确有单形态测试，请在此写明原因 —— 缺口要写在明处，不要靠白名单悄悄不跑。
      ],
    },
  }),
)
