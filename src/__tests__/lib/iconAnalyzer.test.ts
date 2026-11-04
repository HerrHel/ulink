import { describe, it, expect } from 'vitest'
import { analyzePixelData } from '../../lib/iconAnalyzer.js'

describe('iconAnalyzer - 像素特征自动视觉分析引擎', () => {
  it('正确识别纯黑透明剪影图标（如 GitHub/Apple/Vercel）', () => {
    // 构造一个 4x4 图像：四周透明，中间 4 个纯黑像素 (RGB: 10,10,10)
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const idx = (y * 4 + x) * 4
        if (x >= 1 && x <= 2 && y >= 1 && y <= 2) {
          // 前景剪影
          data[idx] = 15
          data[idx + 1] = 15
          data[idx + 2] = 15
          data[idx + 3] = 255
        } else {
          // 透明背景
          data[idx] = 0
          data[idx + 1] = 0
          data[idx + 2] = 0
          data[idx + 3] = 0
        }
      }
    }

    const shouldInvert = analyzePixelData(4, 4, data)
    expect(shouldInvert).toBe(true)
  })

  it('正确识别彩色品牌图标（如 Supabase 翠绿），绝不反色', () => {
    // 构造一个类似 Supabase 的图像：深色底座 + 翠绿闪电
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < data.length; i += 4) {
      if (i < 32) {
        // 翠绿 (RGB: 62, 207, 142)
        data[i] = 62
        data[i + 1] = 207
        data[i + 2] = 142
        data[i + 3] = 255
      } else {
        // 深灰背景 (RGB: 28, 28, 28)
        data[i] = 28
        data[i + 1] = 28
        data[i + 2] = 28
        data[i + 3] = 255
      }
    }

    const shouldInvert = analyzePixelData(4, 4, data)
    expect(shouldInvert).toBe(false)
  })

  it('正确识别其他彩色图标（如 Raycast 绯红、YouTube 红），绝不反色', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < data.length; i += 4) {
      // 绯红 (RGB: 255, 99, 99)
      data[i] = 255
      data[i + 1] = 99
      data[i + 2] = 99
      data[i + 3] = 255
    }
    const shouldInvert = analyzePixelData(4, 4, data)
    expect(shouldInvert).toBe(false)
  })

  it('本身就是白色/浅灰色的透明剪影，无需反色', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const idx = (y * 4 + x) * 4
        if (x >= 1 && x <= 2 && y >= 1 && y <= 2) {
          // 白色前景 (RGB: 240, 240, 240)
          data[idx] = 240
          data[idx + 1] = 240
          data[idx + 2] = 240
          data[idx + 3] = 255
        } else {
          // 透明背景
          data[idx] = 0
          data[idx + 1] = 0
          data[idx + 2] = 0
          data[idx + 3] = 0
        }
      }
    }
    const shouldInvert = analyzePixelData(4, 4, data)
    expect(shouldInvert).toBe(false)
  })

  it('空数据或全透明图像安全返回 false', () => {
    expect(analyzePixelData(0, 0, new Uint8ClampedArray())).toBe(false)
    const transparent = new Uint8ClampedArray(16 * 4) // 4x4 全透明
    expect(analyzePixelData(4, 4, transparent)).toBe(false)
  })
})
