/**
 * useCardOverflow — 检测卡片 body 内容是否溢出，仅在溢出时应用淡出遮罩
 * 通过 ResizeObserver 监听 card-body 元素的 scrollHeight 变化。
 *
 * PERF：模块级单例 ResizeObserver + WeakMap 注册表。旧实现每张卡片实例化一个
 * ResizeObserver，大网格/虚拟列表下数百卡片 = 数百独立 RO 实例，回调抖动与每个
 * RO 自身调度开销随卡片数线性增长。改为全局唯一 RO，回调时按触发元素查 WeakMap
 * 执行各自 check。WeakMap 不阻止 GC：卡片卸载、body 被回收后注册自动失效。
 * 对外签名（useCardOverflow(cardRef) → { hasOverflow }）完全不变。
 */
import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'

const _handlers = new WeakMap<HTMLElement, () => void>()
let _sharedRO: ResizeObserver | null = null

function _getRO(): ResizeObserver {
  if (!_sharedRO) {
    _sharedRO = new ResizeObserver(entries => {
      for (const entry of entries) {
        const handler = _handlers.get(entry.target as HTMLElement)
        if (handler) handler()
      }
    })
  }
  return _sharedRO
}

export function useCardOverflow(cardRef: Ref<HTMLElement | null>) {
  const hasOverflow = ref(false)

  function check() {
    const body = cardRef.value?.querySelector('.card-body') as HTMLElement | null
    if (!body) return
    const overflow = body.scrollHeight > body.clientHeight + 1
    if (overflow !== hasOverflow.value) {
      hasOverflow.value = overflow
      cardRef.value?.classList.toggle('card-overflow', overflow)
    }
  }

  // 模块级单例 RO 的回调只认 WeakMap 里注册的 body；onMounted 失败时不注册，与旧实现一致
  let _body: HTMLElement | null = null

  /** 在新 cardEl 下重设 _body 观察：清旧 _body 的 unobserve+delete，再从新 cardEl 找 .card-body 注册。 */
  function _reattach(newEl: HTMLElement | null) {
    if (_body) {
      _getRO().unobserve(_body)
      _handlers.delete(_body)
      _body = null
    }
    const body = newEl?.querySelector('.card-body') as HTMLElement | null
    if (!body) {
      // cardEl=null 或无 body（聚焦态无折叠布局）：遮罩不应残留，但 newEl 为 null 时无法写类，
      // hasOverflow 仅是返回值无副作用，留原态让下次新 cardEl 重挂时 check() 校正。
      return
    }
    _body = body
    _handlers.set(_body, check)
    _getRO().observe(_body)
    check()
  }

  onMounted(() => _reattach(cardRef.value))

  // cardRef 变化（如 GroupCard v-if(isFocused)/v-else 切根节点，动态 :ref="setCardEl"
  // 在 null↔newEl 间切换）：必须重设观察，否则 _body 仍指向已卸载的旧 .card-body，
  // RO 不再触发回调，退回折叠态后溢出遮罩失效 + WeakMap/RO 仍占住旧已分离节点致轻泄漏。
  watch(cardRef, (newEl) => _reattach(newEl))

  onBeforeUnmount(() => {
    if (_body) {
      _getRO().unobserve(_body)
      _handlers.delete(_body)
      _body = null
    }
  })

  return { hasOverflow }
}
