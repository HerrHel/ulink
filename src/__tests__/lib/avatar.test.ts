import { describe, it, expect } from 'vitest'
import { PRESET_AVATAR_EMOJIS } from '../../lib/avatar.js'

describe('avatar.ts — Emoji 预设库', () => {
  it('预设 Emoji 列表符合预期且不重复', () => {
    expect(PRESET_AVATAR_EMOJIS.length).toBe(16)
    const unique = new Set(PRESET_AVATAR_EMOJIS)
    expect(unique.size).toBe(16)
  })

  it('包含常用经典 Emoji', () => {
    expect(PRESET_AVATAR_EMOJIS).toContain('🚀')
    expect(PRESET_AVATAR_EMOJIS).toContain('☕')
    expect(PRESET_AVATAR_EMOJIS).toContain('🌿')
  })
})

