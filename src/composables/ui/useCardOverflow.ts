/**
 * useCardOverflow — 检测卡片 body 内容是否溢出，仅在溢出时应用淡出遮罩
 * 通过 ResizeObserver 监听 card-body 元素的 scrollHeight 变化
 */
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useCardOverflow(cardRef: Ref<HTMLElement | null>) {
  const hasOverflow = ref(false)
  let observer: ResizeObserver | null = null

  function check() {
    const body = cardRef.value?.querySelector('.card-body') as HTMLElement | null
    if (!body) return
    const overflow = body.scrollHeight > body.clientHeight + 1
    if (overflow !== hasOverflow.value) {
      hasOverflow.value = overflow
      cardRef.value?.classList.toggle('card-overflow', overflow)
    }
  }

  onMounted(() => {
    const body = cardRef.value?.querySelector('.card-body') as HTMLElement | null
    if (!body) return
    observer = new ResizeObserver(check)
    observer.observe(body)
    check()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return { hasOverflow }
}
