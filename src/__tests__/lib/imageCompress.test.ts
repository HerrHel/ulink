import { describe, it, expect } from 'vitest'
import {
  computeScale,
  pickOutputMime,
  fileExtension,
  baseName,
} from '../../lib/imageCompress.js'

describe('imageCompress 纯函数', () => {
  describe('computeScale', () => {
    it('最长边超过 maxSize 时等比缩放', () => {
      expect(computeScale(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 })
      expect(computeScale(2000, 4000, 1600)).toEqual({ width: 800, height: 1600 })
    })

    it('最长边不超过 maxSize 时保持原尺寸', () => {
      expect(computeScale(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    })

    it('非法/零尺寸不缩放、不产生 0 或 NaN', () => {
      expect(computeScale(0, 0, 1600)).toEqual({ width: 0, height: 0 })
      // 负宽输入（异常场景）：Math.max(1,…) 兜底，不产生负值/NaN
      const r = computeScale(-1, 5000, 1600)
      expect(r.width).toBeGreaterThanOrEqual(1)
      expect(r.height).toBe(1600)
    })

    it('缩放后最小保留 1px', () => {
      const r = computeScale(1, 3200, 1600)
      expect(r.height).toBe(1600)
      expect(r.width).toBe(1)
    })
  })

  describe('pickOutputMime', () => {
    it('显式 webp / jpeg', () => {
      expect(pickOutputMime('image/png', 'webp')).toBe('image/webp')
      expect(pickOutputMime('image/png', 'jpeg')).toBe('image/jpeg')
    })
    it('auto 默认 webp', () => {
      expect(pickOutputMime('image/png', 'auto')).toBe('image/webp')
      expect(pickOutputMime('image/jpeg', 'auto')).toBe('image/webp')
    })
  })

  describe('fileExtension', () => {
    it('常见 MIME → 扩展名', () => {
      expect(fileExtension('image/webp')).toBe('webp')
      expect(fileExtension('image/jpeg')).toBe('jpg')
      expect(fileExtension('image/png')).toBe('png')
      expect(fileExtension('image/gif')).toBe('gif')
      expect(fileExtension('image/svg+xml')).toBe('svg')
      expect(fileExtension('application/octet-stream')).toBe('bin')
    })
  })

  describe('baseName', () => {
    it('去掉扩展名', () => {
      expect(baseName('photo.png')).toBe('photo')
      expect(baseName('a.b.c.jpg')).toBe('a.b.c')
    })
    it('去掉路径分隔符', () => {
      expect(baseName('C:\\dir\\photo.png')).toBe('photo')
      expect(baseName('/dir/photo.png')).toBe('photo')
    })
    it('空名兜底 image', () => {
      expect(baseName('')).toBe('image')
      expect(baseName('.png')).toBe('image')
    })
  })
})
