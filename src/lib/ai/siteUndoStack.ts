/**
 * siteUndoStack.ts — 站内指令撤销事务栈（自 siteCommander.ts 纯搬运拆出）
 * 职责：
 * 1. 维护模块级单例 undo 栈（pushUndoAction 与 popUndoAction 共享同一栈实例）；
 * 2. 记录最近一次可撤销动作，供对话式撤销 (/undo) 逐级回退。
 * 行为与拆分前逐字一致，禁止改动任何逻辑。
 */

export interface UndoableAction {
  type: string
  description: string
  timestamp?: number
  revert: () => Promise<string> | string
}

export const MAX_UNDO_STACK_DEPTH = 15
const undoTransactionStack: UndoableAction[] = []

let lastUndoableAction: UndoableAction | null = null

export function pushUndoAction(action: UndoableAction): void {
  action.timestamp = action.timestamp || Date.now()
  undoTransactionStack.push(action)
  if (undoTransactionStack.length > MAX_UNDO_STACK_DEPTH) {
    undoTransactionStack.shift()
  }
  lastUndoableAction = action
}

export function popUndoAction(): UndoableAction | null {
  const action = undoTransactionStack.pop() || null
  lastUndoableAction = undoTransactionStack.length > 0 ? undoTransactionStack[undoTransactionStack.length - 1] : null
  return action
}

export function getUndoStackDepth(): number {
  return undoTransactionStack.length
}

export function clearUndoStack(): void {
  undoTransactionStack.length = 0
  lastUndoableAction = null
}

export function getLastUndoableAction(): UndoableAction | null {
  return lastUndoableAction || (undoTransactionStack.length > 0 ? undoTransactionStack[undoTransactionStack.length - 1] : null)
}

export function setLastUndoableAction(action: UndoableAction | null): void {
  if (action) {
    pushUndoAction(action)
  } else {
    lastUndoableAction = null
    undoTransactionStack.pop()
  }
}
