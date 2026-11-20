/**
 * share-ssr 子进程预加载桩（node -r 注入）：把 @cloudbase/node-sdk 替换成假实现。
 *
 * - 所有 rpc 一律返回 { data: null, error: null }，即「分享不存在 / 未公开」；
 *   这样合法格式的 id 会走真实的「查库后 404」分支，可与畸形路径的 404 逐字节比对。
 * - 每次 rpc 调用向 stdout 打一行 `[fake-rpc] <函数名>`，测试据此断言
 *   畸形路径在查库前就已返回（不触达数据库）。
 */
const Module = require('module')

const fakeSdk = {
  init() {
    return {
      rdb() {
        return {
          async rpc(name) {
            process.stdout.write(`[fake-rpc] ${name}\n`)
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
