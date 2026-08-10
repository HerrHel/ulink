/**
 * boundedCache — 有上界的 LRU 缓存（纯函数工厂）
 *
 * 为 useVirtualScroll._styleCache 而生：原实现是裸 `new Map()` 只写不逐出，
 * 在长会话 / 大数据量分类下反复滚动浏览，缓存随「滚动触达过的每个 (index,height) 键」
 * 线性单调增长，PC↔移动端 itemHeight 切换时新建整族键旧族永不释放 —— 真内存泄漏。
 * 本模块给缓存加上界 + LRU 淘汰最旧项，把"只写不删"的结构缺陷封死在 maxSize 内。
 *
 * 通用纯工具：仅依赖 Map 的插入序天然就是 LRU 顺序（读命中时不重排——本场景
 * 命中即复用 style 对象，无需更新访问序，旧项淘汰只看插入先后足够防无界增长）。
 */

export interface BoundedCache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): void
  has(key: K): boolean
  delete(key: K): void
  /** 当前条目数（测试与自检用） */
  readonly size: number
  /** 清空 */
  clear(): void
}

/**
 * 创建有上界的缓存。超过 maxSize 时淘汰最早插入的键（Map 迭代序 = 插入序）。
 *
 * @param maxSize 最大条目数；满时新 set 触发淘汰最旧一项。必须 ≥1。
 */
export function createBoundedCache<K, V>(maxSize: number): BoundedCache<K, V> {
  if (maxSize < 1 || !Number.isFinite(maxSize)) {
    throw new Error(`createBoundedCache: maxSize must be a finite number ≥ 1, got ${maxSize}`)
  }
  const map = new Map<K, V>()

  return {
    get(key) {
      return map.get(key)
    },
    set(key, value) {
      // 已存在则覆盖原值，不新增条目（key 复用，size 不变）。
      // 注意：Map.set 对已存在 key 按规约不改变其插入序位置，故覆盖不重排淘汰顺序。
      // 本场景（缓存复用 style 对象）无需更新访问序，覆盖即位即可。
      if (map.has(key)) {
        map.set(key, value)
        return
      }
      // 新键 + 已满 → 淘汰最早插入项（Map.prototype.keys().next() 即首项）
      if (map.size >= maxSize) {
        const oldest = map.keys().next()
        if (!oldest.done) map.delete(oldest.value)
      }
      map.set(key, value)
    },
    has(key) {
      return map.has(key)
    },
    delete(key) {
      map.delete(key)
    },
    get size() {
      return map.size
    },
    clear() {
      map.clear()
    },
  }
}
