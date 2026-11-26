/**
 * share-ssr 子进程预加载桩（node -r 注入）：把 @cloudbase/node-sdk 替换成假实现。
 *
 * - 所有 rpc 一律返回 { data: null, error: null }，即「分享不存在 / 未公开」；
 *   这样合法格式的 id 会走真实的「查库后 404」分支，可与畸形路径的 404 逐字节比对。
 * - 每次 rpc 调用向 stdout 打一行 `[fake-rpc] <函数名>`，测试据此断言
 *   畸形路径在查库前就已返回（不触达数据库）。
 * - 可选：环境变量 FAKE_RPC 为 JSON {"<函数名>": {"<第一个参数值>": <data>}}，命中则返回该 data
 *   （用于需要「分享存在 / 有密码」的用例；未配置时行为不变）。
 */
const Module = require('module')

let FAKE_RPC = {}
try { FAKE_RPC = JSON.parse(process.env.FAKE_RPC || '{}') } catch { FAKE_RPC = {} }

const fakeSdk = {
  init() {
    return {
      rdb() {
        return {
          async rpc(name, args) {
            process.stdout.write(`[fake-rpc] ${name}\n`)
            const preset = FAKE_RPC[name]
            const key = args ? String(Object.values(args)[0]) : ''
            if (preset && Object.prototype.hasOwnProperty.call(preset, key)) return { data: preset[key], error: null }
            return { data: null, error: null }
          },
        }
      },
    }
  },
}

const originalRequire = Module.prototype.require
Module.prototype.require = function patchedRequire(id) {
  if (id === '@cloudbase/node-sdk') return fakeSdk
  return originalRequire.apply(this, arguments)
}
