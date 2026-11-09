/**
 * lib/supabase.js — Supabase 形状兼容 shim（CloudBase 版）
 *
 * 历史：本文件曾是 194KB 的 supabase-js 打包件。2026-10-22 后端迁 CloudBase，
 * 换为 @cloudbase/js-sdk（lib/cloudbase-sdk.js，IIFE 挂 CloudBaseSdk）的适配层，
 * 对 sidepanel.js 保持 `window.supabase.createClient(url, key)` → { from, auth } 同形，
 * **调用点零改动**（不接收第三参数 opts：Supabase 风格 auth 配置在 CloudBase 无可映射项，
 * 详见 createClient 处注释）。CloudBase js-sdk 的 rdb/auth 本就 Supabase 同形（{data,error}、
 * INITIAL_SESSION 事件等），唯一硬差异是 verifyOtp：
 *  - Supabase：auth.verifyOtp({email, token, type}) 独立调用；
 *  - CloudBase：signInWithOtp 返回 data.verifyOtp({token}) 闭包（messageId 已绑）。
 * 本 shim 按邮箱暂存闭包，把独立 verifyOtp 转发过去（与主站 authDriver 同款方案）。
 *
 * 约定：createClient 的第一参数语义为 **CloudBase envId**（config.js 里叫
 * `CLOUDBASE_ENV_ID`），第二参数为 **CloudBase publishable key**（`CLOUDBASE_PUBLISHABLE_KEY`）。
 * `window.supabase` / 文件名只是历史兼容命名，不是 Supabase 后端。
 */
(function () {
  'use strict'

  function getInit() {
    var sdk = window.CloudBaseSdk
    if (!sdk) return null
    var ns = sdk.default || sdk
    return typeof ns.init === 'function' ? ns.init.bind(ns) : null
  }

  // 仅接收 (envId, publishableKey)：CloudBase js-sdk 的 auth 存储键固定为
  // credentials_<envId> / tcb_*，Supabase 风格的 storageKey / persistSession /
  // autoRefreshToken 无可映射项，故不提供第三参数，避免「传了却静默丢弃」的假契约。
  function createClient(envOrUrl, publishableKey) {
    var init = getInit()
    if (!init) {
      console.error('[cb-shim] CloudBaseSdk missing (lib/cloudbase-sdk.js not loaded)')
      var dead = Promise.resolve({ data: null, error: { message: 'cloudbase sdk not loaded' } })
      return { from: function () { return dead }, auth: {} }
    }
    var app = init({ env: String(envOrUrl || ''), accessKey: publishableKey, auth: { detectSessionInUrl: false } })
    var auth = app.auth
    // email → signInWithOtp 返回的 verifyOtp 闭包（messageId 绑定于闭包内）
    var otpClosures = Object.create(null)

    return {
      from: function (table) { return app.rdb().from(table) },
      auth: {
        getSession: function () { return auth.getSession() },
        onAuthStateChange: function (cb) { return auth.onAuthStateChange(cb) },
        signOut: function () { return auth.signOut() },
        setSession: function (p) { return auth.setSession(p) },
        signInWithOtp: async function (p) {
          var r = await auth.signInWithOtp(p)
          var closure = r && r.data && r.data.verifyOtp
          if (closure && p && p.email) otpClosures[p.email] = closure
          return r
        },
        verifyOtp: function (p) {
          var closure = p && p.email ? otpClosures[p.email] : null
          if (!closure) {
            return Promise.resolve({ data: null, error: { message: 'no pending verification for this email' } })
          }
          delete otpClosures[p.email]
          return closure({ token: p.token })
        },
      },
    }
  }

  window.supabase = { createClient: createClient }
})()
