/**
 * useChatInputInteraction — 聊天输入框交互逻辑（自 DetailPanel.vue 抽出，行为零变化）
 *
 * 职责：斜杠指令快捷联想（显示条件 / 前缀过滤 / 高亮索引）+ handleKeyDown 键盘调度
 * （IME 守卫 / Esc 清空输入 / 补全菜单导航与选中 / Tab 前缀补全 / 终端式 ↑↓ 历史回溯 / Enter 提交）
 * + quickFill 快捷填充。
 * 仅含交互状态与调度；DOM 副作用（输入框高度、聚焦）通过回调注入，不直接碰面板 DOM。
 */
import { computed, ref, nextTick, watch, type Ref } from 'vue'
import { useI18n } from '../../i18n/index.js'

/** 斜杠指令项（title/desc 由 titleKey/descKey 经 t() 渲染） */
export interface SlashCommandItem {
  cmd: string
  titleKey: string
  descKey: string
}

/** 本层依赖的共享状态与回调（由 DetailPanel 注入） */
export interface ChatInputInteractionDeps {
  aiQuery: Ref<string>
  textareaRef: Ref<HTMLTextAreaElement | null>
  /** 斜杠指令表（useAiChat 提供） */
  slashCommands: SlashCommandItem[]
  /** 斜杠补全（useAiChat 提供） */
  applySlashCommand: (cmd: string) => void
  /** 提交对话（useAiChat 的 handleAiSubmit） */
  submit: () => void
  /** 输入框高度自适应（useChatPanelDom 提供） */
  adjustTextareaHeight: () => void
  /** 终端式命令历史回溯状态（useAiChat 提供） */
  inputHistory: Ref<string[]>
  historyCursor: Ref<number>
  tempInput: Ref<string>
}

export function useChatInputInteraction(deps: ChatInputInteractionDeps) {
  const {
    aiQuery,
    textareaRef,
    slashCommands,
    applySlashCommand,
    submit,
    adjustTextareaHeight,
    inputHistory,
    historyCursor,
    tempInput,
  } = deps
  const { t } = useI18n()

  // ── IME 组合态 ──
  // 抽屉 textarea（ChatInputDock）由宿主把 keydown 交到本 composable，但模板未接
  // composition 事件。中文输入法 compositionend 后 Chrome/Windows 会伴生一个尾随
  // Enter keydown，此时 isComposing 已复位，仅靠 e.isComposing/keyCode===229 挡不住。
  // 这里下沉 60ms 保护：保存 timer handle，每次先 clearTimeout，防旧 timer 提前复位。
  const isComposing = ref(false)
  const compositionJustEnded = ref(false)
  let compositionEndTimer: ReturnType<typeof setTimeout> | null = null

  function onCompositionStart() {
    isComposing.value = true
    compositionJustEnded.value = false
    if (compositionEndTimer) { clearTimeout(compositionEndTimer); compositionEndTimer = null }
  }

  function onCompositionEnd(e?: CompositionEvent) {
    isComposing.value = false
    compositionJustEnded.value = true
    // 每次先清掉上一个 timer：多次 compositionend 各起一个 60ms timer 时，
    // 旧 timer 会提前把标志复位，尾随 Enter 又被误提交。
    if (compositionEndTimer) clearTimeout(compositionEndTimer)
    compositionEndTimer = setTimeout(() => {
      compositionJustEnded.value = false
      compositionEndTimer = null
    }, 60)
    // compositionend 时 v-model 可能尚未 flush，同步 DOM 值防止提交空内容
    const target = e?.target as HTMLTextAreaElement | undefined
    if (target && target.value !== undefined) aiQuery.value = target.value
  }

  // 自行监听宿主共享的 textarea：DetailPanel 无需改模板接线，ref 变化（切换/卸载置 null）
  // 时自动移除旧监听。
  watch(textareaRef, (el, _prev, onCleanup) => {
    if (!el) return
    el.addEventListener('compositionstart', onCompositionStart)
    el.addEventListener('compositionend', onCompositionEnd)
    onCleanup(() => {
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
    })
  }, { immediate: true })

  // ── 斜杠指令快捷联想（文案走 i18n，与语言包 slash* 键一一对应）──
  const activeSlashIndex = ref(0)
  const showSlashSuggest = computed(() => {
    const q = aiQuery.value.trim()
    return q.startsWith('/') && !q.includes(' ')
  })

  const filteredSlashCommands = computed(() => {
    const q = aiQuery.value.trim().toLowerCase()
    return slashCommands.filter((c) => c.cmd.startsWith(q)).map((c) => ({
      cmd: c.cmd,
      title: t(c.titleKey),
      desc: t(c.descKey),
    }))
  })

  watch(filteredSlashCommands, () => {
    activeSlashIndex.value = 0
  })

  function quickFill(text: string) {
    aiQuery.value = text
    submit()
  }

  function handleKeyDown(e: KeyboardEvent) {
    const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13
    // IME 组合中的按键（选词/确认）交还输入法，防 Enter 误提交、方向键误翻历史
    if (isComposing.value || e.isComposing || e.keyCode === 229) return
    // compositionend 后 60ms 内 Chrome/Windows 会伴生一个尾随 Enter keydown，
    // 此时 isComposing 已是 false，上面的守卫挡不住：吞掉（不提交、不换行）。
    if (compositionJustEnded.value) {
      if (isEnter) e.preventDefault()
      return
    }
    // Esc：有输入内容/补全菜单时先清空输入（拦截不上抛，防全局清扫连带关掉面板）；
    // 空输入时放行给全局 Esc（关闭整个面板）
    if (e.key === 'Escape' && (showSlashSuggest.value || aiQuery.value)) {
      e.preventDefault()
      e.stopPropagation()
      aiQuery.value = ''
      adjustTextareaHeight()
      return
    }
    // 斜杠补全菜单的上下键与回车优先
    if (showSlashSuggest.value && filteredSlashCommands.value.length) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        activeSlashIndex.value =
          (activeSlashIndex.value - 1 + filteredSlashCommands.value.length) %
          filteredSlashCommands.value.length
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        activeSlashIndex.value =
          (activeSlashIndex.value + 1) % filteredSlashCommands.value.length
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const chosen = filteredSlashCommands.value[activeSlashIndex.value]
        if (chosen) applySlashCommand(chosen.cmd)
        return
      }
    }

    // 若用户按了 Tab，当前输入了斜杠前缀但尚未有空格
    if (e.key === 'Tab' && aiQuery.value.startsWith('/') && !aiQuery.value.includes(' ')) {
      const prefix = aiQuery.value.trim().toLowerCase()
      const match = slashCommands.find((c) => c.cmd.toLowerCase().startsWith(prefix))
      if (match) {
        e.preventDefault()
        applySlashCommand(match.cmd)
        return
      }
    }

    // 终端式命令历史回溯 (ArrowUp / ArrowDown)
    if (e.key === 'ArrowUp') {
      const el = textareaRef.value
      if (el && (el.selectionStart === 0 || !aiQuery.value.includes('\n'))) {
        if (inputHistory.value.length > 0 && historyCursor.value > 0) {
          e.preventDefault()
          if (historyCursor.value === inputHistory.value.length) {
            tempInput.value = aiQuery.value
          }
          historyCursor.value--
          aiQuery.value = inputHistory.value[historyCursor.value]
          nextTick(() => adjustTextareaHeight())
          return
        }
      }
    } else if (e.key === 'ArrowDown') {
      const el = textareaRef.value
      if (el && (el.selectionEnd === aiQuery.value.length || !aiQuery.value.includes('\n'))) {
        if (historyCursor.value < inputHistory.value.length - 1) {
          e.preventDefault()
          historyCursor.value++
          aiQuery.value = inputHistory.value[historyCursor.value]
          nextTick(() => adjustTextareaHeight())
          return
        } else if (historyCursor.value === inputHistory.value.length - 1) {
          e.preventDefault()
          historyCursor.value = inputHistory.value.length
          aiQuery.value = tempInput.value
          nextTick(() => adjustTextareaHeight())
          return
        }
      }
    }

    if (isEnter) {
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Shift+Enter 允许换行
        return
      }
      e.preventDefault()
      const el = textareaRef.value
      if (el && el.value && !aiQuery.value) {
        aiQuery.value = el.value
      }
      submit()
    }
  }

  return {
    activeSlashIndex,
    showSlashSuggest,
    filteredSlashCommands,
    quickFill,
    handleKeyDown,
    onCompositionStart,
    onCompositionEnd,
    compositionJustEnded,
  }
}
