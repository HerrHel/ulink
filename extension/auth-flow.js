// extension/auth-flow.js — Auth 状态变化决策纯函数（无 chrome.* / supabase / DOM 依赖，可 vitest 测）。
// A3 契约锁：Supabase v2 onAuthStateChange 注册即发 INITIAL_SESSION（当前会话快照），
// 由 sidepanel.js checkAuth() 的 getSession() 独占加载——listener 收到 INITIAL_SESSION
// 应跳过不触发 loadFromCloud，避免启动双网络查询 + 双渲染。抽纯函数把「跳过 INITIAL_SESSION」
// 锁为可回归断言：SDK 未来若改事件名/行为（如 INITIAL_SESSION 改名），测试会 fail 提示。
// 挂 window.LinkVaultAuthFlow 全局（仿 config.js / keypress.js 范式），sidepanel.js 消费。
(function () {
  function handleAuthStateChange(event, session) {
    if (event === 'INITIAL_SESSION') return { action: 'skip' }
    if (session && session.user) {
      return { action: 'authed', user: session.user }
    }
    return { action: 'signedout' }
  }
  window.LinkVaultAuthFlow = { handleAuthStateChange: handleAuthStateChange }
})()
