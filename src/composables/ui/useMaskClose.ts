/**
 * 遮罩层点击关闭防误触 composable
 *
 * 背景与机理：
 * 当用户在弹窗输入框内按住鼠标框选文本，拖出弹窗并在遮罩层松开鼠标时，
 * 浏览器会将 click 事件派发给两者的最近公共祖先（即遮罩层本身）。
 * 若仅依靠 `@click.self`，由于 event.target === event.currentTarget 成立，
 * 会导致弹窗被意外关闭、未保存内容丢失。
 *
 * 解决方案：
 * 只有当 mousedown 和 mouseup 均落在遮罩层本身时，才认定为合法的遮罩点击关闭。
 */
export function useMaskClose(onClose: () => void) {
  let isMouseDownOnMask = false

  function onMaskMouseDown(e: MouseEvent) {
    if (e.target !== e.currentTarget) {
      isMouseDownOnMask = false
      return
    }
    isMouseDownOnMask = true

    const onGlobalMouseUp = (upEv: MouseEvent) => {
      if (upEv.target !== e.currentTarget) {
        isMouseDownOnMask = false
      }
    }
    window.addEventListener('mouseup', onGlobalMouseUp, { once: true })
  }

  function onMaskClick(e: MouseEvent) {
    if (isMouseDownOnMask && e.target === e.currentTarget) {
      onClose()
    }
    isMouseDownOnMask = false
  }

  return {
    onMaskMouseDown,
    onMaskClick,
    maskHandlers: {
      mousedown: onMaskMouseDown,
      click: onMaskClick,
    },
  }
}
