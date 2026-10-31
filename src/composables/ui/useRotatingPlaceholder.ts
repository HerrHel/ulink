/**
 * useRotatingPlaceholder.ts — AI 输入框使用技巧温润轮播钩子
 *
 * 核心设计：
 * 1. 启发式使用技巧轮播（Prompt Starters / Feature Discovery）：
 *    轮播展示包括「视频灵感收割与深度提炼」、「自然语言整理书签」、「工作台搭建」、「拖拽卡片引用」等核心特性；
 * 2. 交互尊重：输入框获得焦点 (focused) 或已有输入内容时自动暂停轮播，失去焦点且内容为空时恢复轮播；
 * 3. 双语自适应：跟随当前系统语言自动输出对应中英文案；
 * 4. 资源自清：组件卸载时自动清理定时器，杜绝内存泄漏。
 */

import { ref, computed, onMounted, onUnmounted, getCurrentInstance, type Ref } from 'vue'
import { getLocale } from '../../i18n/index.js'

export interface RotatingTipItem {
  zh: string
  en: string
}

export const WORKSPACE_TIPS: readonly RotatingTipItem[] = [
  {
    zh: '粘贴视频链接，提取标题/简介/字幕里出现的网站并整理笔记…',
    en: 'Paste a video link to extract sites from its title/description/subtitles...',
  },
  {
    zh: '向与链提问，或拖拽卡片到此处直接引用…',
    en: 'Ask ulink anything, or drop cards here to mention...',
  },
  {
    zh: '输入“整理所有未分类书签”，一键智能归类到对应目录…',
    en: 'Try "organize uncategorized bookmarks" to auto-categorize...',
  },
  {
    zh: '输入“帮我搭建前端技术工作台”，自动聚合专属卡片与笔记…',
    en: 'Try "build a frontend workspace" to aggregate cards and notes...',
  },
]

export function useRotatingPlaceholder(options: {
  isFocused?: Ref<boolean>
  hasContent?: Ref<boolean>
  intervalMs?: number
  tips?: readonly RotatingTipItem[]
} = {}) {
  const {
    isFocused,
    hasContent,
    intervalMs = 4500,
    tips = WORKSPACE_TIPS,
  } = options

  const currentIndex = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  const isZh = computed(() => getLocale().startsWith('zh'))

  const currentPlaceholder = computed(() => {
    const tip = tips[currentIndex.value] || tips[0]
    return isZh.value ? tip.zh : tip.en
  })

  function startRotation() {
    stopRotation()
    timer = setInterval(() => {
      // 若当前获得焦点或已有输入，暂停推进轮播下标
      if (isFocused?.value || hasContent?.value) {
        return
      }
      currentIndex.value = (currentIndex.value + 1) % tips.length
    }, intervalMs)
  }

  function stopRotation() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      startRotation()
    })
    onUnmounted(() => {
      stopRotation()
    })
  } else {
    // 单元测试或非组件环境直接自启
    startRotation()
  }

  return {
    currentIndex,
    currentPlaceholder,
    startRotation,
    stopRotation,
  }
}
