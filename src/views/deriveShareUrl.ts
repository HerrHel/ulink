/**
 * 推导公开分享组的规范化 URL（canonical / og:url / twitter / JSON-LD 共用）。
 *
 * 从 ShareView.vue 的 `_applyShareHead` 抽出的纯推导核——把 location.pathname/origin 副作用
 * 入参化，使「剥部署前缀 + 拼 s/<gid> 锚」的字符串拼装可直测，锁住「不产双 `/s/`」契约。
 *
 * bug 背景（R10 真 bug）：旧正则 `/\/[^/]*$/` 只剥 pathname 末段。但 `_applyShareHead` 在
 * ShareView 活跃时跑，此时 location.pathname 形如「<部署前缀>/s/<gid>」，旧正则只剥 `<gid>`
 * 残留「<部署前缀>/s/」，再拼一遍 `s/<gid>` 产生「<部署前缀>/s/s/<gid>」双段错误 URL，污染
 * canonical/og:url/twitter:url/JSON-LD url 全部指向不存在的双 s/ 路径。
 *
 * 正确推导：先剥整段 `/s/<gid>` 得到部署前缀（含子路径如 `/linkvault/`，根部署剥成 `/`），
 * 再拼回 `s/<gid>#share/<gid>`。外层 `useDataShare` 主路由态的同类正则因 pathname 不含 `/s/`
 * 故 `/\/[^/]*$/` 凑巧正确，ShareView 子路由态必须用剥整段 `/s/<gid>` 的口径。
 *
 * @param pathname location.pathname（ShareView 活跃时形如「<前缀>/s/<gid>」）
 * @param origin  location.origin
 * @param groupId 公开组 id
 */
export function deriveShareUrl(pathname: string, origin: string, groupId: string): string {
  // 先剥 `/s/<gid>` 整段得部署前缀；剥不到（异常 pathname）回退根 `/`。
  const base = pathname.replace(/\/s\/[^/]*$/, '/') || '/'
  return `${origin}${base}s/${groupId}#share/${groupId}`
}
