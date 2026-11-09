/**
 * 模块 7 专属深度审查与修复回归测试套件
 *
 * 覆盖范围：
 * 1. 法律合规文档公开性判定（isPublicLegalDoc）与内部审核/修订记录泄露防护
 * 2. 真实 docs/legal 目录的合规性过滤与索引页卡片数校验
 * 3. 站点备案信息（ICP 备案号、工信部跳转链接）一致性校验（site.ts / landing.js / index.html）
 * 4. PWA 与 Service Worker 离线更新策略（version.json 强穿透校验、workbox 配置）
 * 5. 安全响应头（CSP、XCTO、frame-ancestors）与 CloudBase 边缘代理配置规范
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_DOC_SEQUENCE,
  isPublicLegalDoc,
  parseLegalDoc,
  renderLegalIndexHtml,
} from '../../lib/legal/renderLegalDoc'
import { ICP_NUMBER, MIIT_URL } from '../../config/site'

describe('模块 7 审计：法律文档公开性判定与泄露防护', () => {
  it('isPublicLegalDoc 仅放行正式对外法律协议，严格排除内部待办与修订记录', () => {
    // 允许的公开法律文档
    expect(isPublicLegalDoc('terms-of-service.md')).toBe(true)
    expect(isPublicLegalDoc('privacy-policy.md')).toBe(true)
    expect(isPublicLegalDoc('refund-policy.md')).toBe(true)

    // 严禁外泄的内部待办、审计与律师复核记录
    expect(isPublicLegalDoc('PENDING.md')).toBe(false)
    expect(isPublicLegalDoc('CHANGELOG-2026-10-31.md')).toBe(false)
    expect(isPublicLegalDoc('CHANGELOG-2026-11-01.md')).toBe(false)
    expect(isPublicLegalDoc('CHANGELOG-2026-11-03.md')).toBe(false)
    expect(isPublicLegalDoc('CHANGELOG-2026-11-07.md')).toBe(false)
    expect(isPublicLegalDoc('CHANGELOG.md')).toBe(false)

    // 非 md 文件与隐藏/临时文件
    expect(isPublicLegalDoc('.gitkeep')).toBe(false)
    expect(isPublicLegalDoc('.draft.md')).toBe(false)
    expect(isPublicLegalDoc('_temp.md')).toBe(false)
    expect(isPublicLegalDoc('terms.txt')).toBe(false)
  })

  it('真实 docs/legal 目录经 isPublicLegalDoc 过滤后，恰好包含且仅包含 3 份对外法律协议', () => {
    const legalDir = resolve(process.cwd(), 'docs/legal')
    const allFiles = readdirSync(legalDir)
    const publicDocs = allFiles.filter(isPublicLegalDoc)

    expect(publicDocs.sort()).toEqual([
      'privacy-policy.md',
      'refund-policy.md',
      'terms-of-service.md',
    ])

    // 内部 CHANGELOG 文件依然物理存在于代码库中供归档核验，但绝未被误判定为 public
    const changelogFiles = allFiles.filter((f) => /^CHANGELOG/i.test(f))
    expect(changelogFiles.length).toBeGreaterThanOrEqual(1)
    for (const cf of changelogFiles) {
      expect(isPublicLegalDoc(cf)).toBe(false)
    }
  })

  it('对外法律索引页渲染仅包含 3 份正式文档卡片，绝无内部修订记录', () => {
    const legalDir = resolve(process.cwd(), 'docs/legal')
    const publicDocs = readdirSync(legalDir)
      .filter(isPublicLegalDoc)
      .map((fileName) => {
        const slug = fileName.replace(/\.md$/i, '')
        const md = readFileSync(resolve(legalDir, fileName), 'utf8')
        return parseLegalDoc(md, slug)
      })

    const indexHtml = renderLegalIndexHtml(publicDocs)

    // 卡片数量严格为 3
    const cardMatches = indexHtml.match(/class="card"/g) || []
    expect(cardMatches.length).toBe(3)

    // 包含 3 份协议链接
    for (const slug of LEGAL_DOC_SEQUENCE) {
      expect(indexHtml).toContain(`/legal/${slug}.html`)
    }

    // 严禁包含 CHANGELOG 或内部审核批注
    expect(indexHtml).not.toContain('CHANGELOG')
    expect(indexHtml).not.toContain('修订对照')
    expect(indexHtml).not.toContain('法律意见待确认')
    expect(indexHtml).not.toContain('发布前检查')
  })
})

describe('模块 7 审计：国家合规备案与工信部跳转一致性', () => {
  it('site.ts、landing.js 与 index.html 中的 ICP 备案号严格一致', () => {
    expect(ICP_NUMBER).toBe('鄂ICP备2026061718号-1')
    expect(MIIT_URL).toBe('https://beian.miit.gov.cn/')

    // 校验 public/landing.js
    const landingJs = readFileSync(resolve(process.cwd(), 'public/landing.js'), 'utf8')
    expect(landingJs).toContain(`ICP_NUMBER = '${ICP_NUMBER}'`)
    expect(landingJs).toContain('https://beian.miit.gov.cn/')

    // 校验 index.html 静态 DOM
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(indexHtml).toContain(ICP_NUMBER)
    expect(indexHtml).toContain('href="https://beian.miit.gov.cn/"')
  })
})

describe('模块 7 审计：构建输出产物与离线 PWA 策略自检', () => {
  it('生产构建产物（若存在 dist）不包含内部 CHANGELOG 生成的 HTML 或 MD', () => {
    const distLegal = resolve(process.cwd(), 'dist/legal')
    if (!existsSync(distLegal)) {
      return // 若未执行 build 则跳过
    }

    const distFiles = readdirSync(distLegal)
    const leakedChangelog = distFiles.filter((f) => /changelog/i.test(f))
    expect(leakedChangelog).toEqual([])

    // 校验 dist/legal/index.html 卡片数
    const distIndexHtml = readFileSync(resolve(distLegal, 'index.html'), 'utf8')
    const cardMatches = distIndexHtml.match(/class="card"/g) || []
    expect(cardMatches.length).toBe(3)
  })

  it('vite.config.ts 保证 version.json 不进入 precache，且导航请求走 NetworkFirst', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

    // globPatterns 只抓取特定静态后缀，保证 version.json（.json）不被 precache 死锁
    expect(viteConfig).toContain("globPatterns: ['**/*.{js,css,svg,woff2}']")

    // 必须有 NetworkFirst 运行时缓存保护离线访问与新版即时更新
    expect(viteConfig).toContain("handler: 'NetworkFirst'")
    expect(viteConfig).toContain("cacheName: 'pages-cache'")
  })

  it('edge-headers 云函数包含完备的安全响应头配置', () => {
    const edgeHeadersPath = resolve(process.cwd(), 'cloudbase/functions/edge-headers/index.js')
    const edgeCode = readFileSync(edgeHeadersPath, 'utf8')

    expect(edgeCode).toContain("'X-Content-Type-Options': 'nosniff'")
    expect(edgeCode).toContain("'X-Frame-Options': 'SAMEORIGIN'")
    expect(edgeCode).toContain("'Strict-Transport-Security': 'max-age=31536000'")
    expect(edgeCode).toContain("frame-ancestors 'self'")
  })

  it('法律文档与索引页页脚正确渲染 ICP 备案号与工信部超链接', () => {
    const doc = parseLegalDoc('# 测试文档\n\n正文内容', 'terms-of-service')
    const docHtml = renderLegalIndexHtml([doc])
    expect(docHtml).toContain('鄂ICP备2026061718号-1')
    expect(docHtml).toContain('https://beian.miit.gov.cn/')
  })
})
