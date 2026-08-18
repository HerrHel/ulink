import { describe, it, expect } from 'vitest'
import {
  GROUP_IMAGES_BUCKET,
  groupImagePath,
  extractGroupImagePaths,
} from '../../lib/imageStorage.js'

describe('imageStorage 纯函数', () => {
  it('groupImagePath 拼接 userId/groupId/filename', () => {
    expect(groupImagePath('u1', 'g1', 'a.webp')).toBe('u1/g1/a.webp')
  })

  it('bucket 名为 group-images', () => {
    expect(GROUP_IMAGES_BUCKET).toBe('group-images')
  })

  describe('extractGroupImagePaths', () => {
    it('从 public URL 提取对象路径', () => {
      const html = '<p><img src="https://abc.supabase.co/storage/v1/object/public/group-images/u1/g1/1.webp" alt=""></p>'
      expect(extractGroupImagePaths(html)).toEqual(['u1/g1/1.webp'])
    })

    it('多张图片按出现顺序提取', () => {
      const html = [
        '<img src="https://x.co/storage/v1/object/public/group-images/u1/g1/1.jpg">',
        '<img src="https://x.co/storage/v1/object/public/group-images/u1/g1/2.png">',
      ].join('')
      expect(extractGroupImagePaths(html)).toEqual(['u1/g1/1.jpg', 'u1/g1/2.png'])
    })

    it('忽略非本 bucket 的图片', () => {
      const html = '<img src="https://x.co/other/1.jpg"><img src="https://x.co/storage/v1/object/public/group-images/u1/g1/ok.webp">'
      expect(extractGroupImagePaths(html)).toEqual(['u1/g1/ok.webp'])
    })

    it('空/无图片返回空数组', () => {
      expect(extractGroupImagePaths('')).toEqual([])
      expect(extractGroupImagePaths('<p>no image</p>')).toEqual([])
    })

    it('URL 编码路径解码还原', () => {
      const html = '<img src="https://x.co/storage/v1/object/public/group-images/u1/g1/%E4%B8%AD.webp">'
      expect(extractGroupImagePaths(html)).toEqual(['u1/g1/中.webp'])
    })
  })
})
