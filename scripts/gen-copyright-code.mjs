import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const SOFTWARE_NAME = process.argv[2] || '与链个人书签管理软件'
const VERSION = process.argv[3] || 'V1.0'

const files = [
  'src/crypto.ts',
  'src/stores/persist.ts',
  'src/stores/storage.ts',
  'src/stores/dataActionsCore.ts',
  'src/stores/dataActionsBookmarks.ts',
  'src/stores/dataActionsGroups.ts',
  'src/stores/dataActionsAttributes.ts',
  'src/stores/dataGetters.ts',
  'src/lib/search.ts',
  'src/composables/domain/syncMergeCore.ts',
  'src/composables/domain/syncCircuit.ts',
  'src/composables/domain/useBookmark.ts',
  'src/composables/domain/useGroup.ts',
  'src/composables/domain/useVault.ts',
  'src/composables/domain/useDataIO.ts',
  'src/composables/domain/useDeadLinkChecker.ts'
]

// 真实、克制、纯实用的程序员手写简短注释（无夸张口吻、无表演感）
const realDevNotes = [
  // 基础与加密
  { match: /function safeAtob/, note: '  // base64 解码容错' },
  { match: /function safeDecodePassword/, note: '  // 兼容未加密的历史密码数据' },
  { match: /export const PBKDF2_ITERATIONS/, note: '  // PBKDF2 迭代轮次（平衡安全性与执行耗时）' },
  { match: /function isThreePartCipher/, note: '  // 校验三段式密文结构，排除域名或版本号误判' },
  { match: /export (async )?function deriveKey/, note: '  // 从主密码派生 AES-256 密钥' },
  { match: /export (async )?function encrypt\(/, note: '  // AES-GCM 加密，每次生成随机 salt 与 iv' },
  { match: /export (async )?function decrypt\(/, note: '  // 解密失败返空，避免向界面透传非法数据' },
  { match: /export (async )?function autoMigratePassword/, note: '  // 自动将旧版 base64 密码迁移至新版密文' },

  // 存储与持久化
  { match: /saveData\(|(async )?function saveData/, note: '  // IDB 权威写入，localStorage 存储轻量快照' },
  { match: /loadFromStorage/, note: '  // 优先加载本地缓存以加快首屏启动' },
  { match: /getStorageInfo/, note: '  // 统计当前存储占用大小' },
  { match: /class DexieStorage|new Dexie/, note: '  // 本地 IndexedDB 数据库操作封装' },
  { match: /async initDB|initStorage/, note: '  // 初始化表结构与索引' },
  { match: /safeSetItem/, note: '  // 本地存储写入安全封装' },
  { match: /safeGetItem/, note: '  // 本地存储读取兜底' },

  // 书签与分组
  { match: /export const OFFICIAL_SITE_BM_ID/, note: '  // 默认固定书签 ID，用于同步去重' },
  { match: /nextBookmarkOrder/, note: '  // 获取当前末尾最大序号' },
  { match: /batchPatchBookmarkAttributes/, note: '  // 批量修改属性，合并触发 dirty 标记' },
  { match: /_persistDeletedGroupMemberships/, note: '  // 暂存已删除分组关联，便于恢复' },
  { match: /addBookmark\(/, note: '  // 新增书签并维护父子层级索引' },
  { match: /deleteBookmark\(/, note: '  // 软删除：标记 deletedAt，进入回收站' },
  { match: /restoreBookmark\(/, note: '  // 从回收站恢复书签及关联分组' },
  { match: /permanentDeleteBookmark\(/, note: '  // 彻底物理删除并清理关联索引' },
  { match: /moveBookmarkToGroup/, note: '  // 移动书签至新分组并更新排序' },
  { match: /reorderBookmarks/, note: '  // 拖拽后重新归一化 order 序号' },

  // 分类与属性
  { match: /addGroup\(/, note: '  // 新增分组并初始化成员列表' },
  { match: /deleteGroup\(/, note: '  // 删除分组，组内书签回退至未分类' },
  { match: /addCategory\(/, note: '  // 新增分类并分配默认色彩' },

  // 状态与过滤
  { match: /_markDirty\(/, note: '  // 标记变更数据待后续同步' },
  { match: /_trackChange\(/, note: '  // 记录变更类型，供本地撤销栈使用' },
  { match: /filterBookmarks/, note: '  // 分类、标签与关键词联合过滤' },
  { match: /_indexOfById/, note: '  // 通过 ID 快速定位数组下标' },
  { match: /_denyWrite/, note: '  // 锁定或只读状态下拒绝写入' },

  // 搜索与拼音
  { match: /_plain\(/, note: '  // 密文字段不进入搜索索引' },
  { match: /ensureSearchLibs/, note: '  // 搜索与拼音分词库按需动态加载' },
  { match: /export (async )?function search\(/, note: '  // 拼音与汉字多字段加权匹配' },
  { match: /buildSearchIndex/, note: '  // 重建搜索索引，防抖处理' },

  // 同步与网络
  { match: /syncMergeCore/, note: '  // 增量同步数据合并，以更新时间戳为准' },
  { match: /resolveConflict/, note: '  // 冲突解决：优先保留本地最新变更' },
  { match: /function syncCircuit/, note: '  // 客户端连续失败熔断退避' },
  { match: /recordSuccess/, note: '  // 请求成功，重置错误计数与熔断状态' },

  // 层级与递归
  { match: /collectSubIds/, note: '  // 递归收集所有后代书签 ID' },
  { match: /checkCycle|isDescendant/, note: '  // 环路检测：禁止将自身或后代设为父级' },
  { match: /toggleExpand/, note: '  // 切换折叠展开状态' },

  // 安全锁
  { match: /export (async )?function lock\(/, note: '  // 锁屏：立即从内存清除解密密钥' },
  { match: /export (async )?function unlock\(/, note: '  // 派生密钥并校验金丝雀密文' },
  { match: /setupVault/, note: '  // 初始化主密码并生成验证密文' },

  // 导入导出与检测
  { match: /export (async )?function exportData/, note: '  // 全量数据导出为标准 JSON 格式' },
  { match: /export (async )?function importData/, note: '  // 导入数据清洗与字段校验' },
  { match: /parseHtmlBookmarks/, note: '  // 解析 HTML 书签文件并还原层级目录' },
  { match: /checkDeadLinks|checkDirect|checkBatch/, note: '  // 探测链接可达性，限制并发请求数' }
]

function processSource() {
  const allLines = []
  const usedNotes = new Set()

  for (const relPath of files) {
    const fullPath = path.resolve(process.cwd(), relPath)
    if (!fs.existsSync(fullPath)) continue
    const content = fs.readFileSync(fullPath, 'utf-8')
    const rawLines = content.split(/\r?\n/)
    let inMultiComment = false

    for (let rawLine of rawLines) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue

      // 跳过多行块注释
      if (inMultiComment) {
        if (trimmed.includes('*/')) inMultiComment = false
        continue
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inMultiComment = true
        continue
      }

      // 跳过原有所有单行注释（只保留下方精准注入的平静实用的备忘）
      if (trimmed.startsWith('//')) {
        continue
      }

      // 过滤调试与控制台语句
      if (/console\.(log|debug|info|warn|error)\(/.test(trimmed)) continue
      if (/^debugger;?$/.test(trimmed)) continue

      // 命中备忘规则时，插入对应的克制实用注释
      for (const item of realDevNotes) {
        if (!usedNotes.has(item.note) && item.match.test(rawLine)) {
          allLines.push(item.note)
          usedNotes.add(item.note)
          break
        }
      }

      // 清理原有行尾可能残留的行尾注释
      let lineToAdd = rawLine.trimEnd()
      if (lineToAdd.includes('//')) {
        const parts = lineToAdd.split('//')
        const codePart = parts[0]
        lineToAdd = codePart.trimEnd()
      }

      if (lineToAdd.trim().length > 0) {
        allLines.push(lineToAdd)
      }
    }
  }
  return allLines
}

const TOTAL_PAGES = 60
const LINES_PER_PAGE = 50
const TARGET_LINES = TOTAL_PAGES * LINES_PER_PAGE // 3000 lines

const rawLines = processSource()
console.log(`Extracted total clean lines: ${rawLines.length}`)

if (rawLines.length < TARGET_LINES) {
  throw new Error(`Not enough clean lines: found ${rawLines.length}, need ${TARGET_LINES}`)
}

let selectedLines = rawLines.slice(0, TARGET_LINES)

// 确保第60页最后一行是干净的大括号闭合或语句结束
let lastIdx = TARGET_LINES - 1
for (let i = TARGET_LINES - 1; i >= TARGET_LINES - 15; i--) {
  const l = selectedLines[i].trim()
  if (l === '}' || l === '};' || l.endsWith('}') || l.endsWith(';')) {
    lastIdx = i
    break
  }
}
if (lastIdx !== TARGET_LINES - 1) {
  const diff = TARGET_LINES - 1 - lastIdx
  selectedLines = rawLines.slice(diff, TARGET_LINES + diff)
}

// 分页排版
const pages = []
for (let p = 0; p < TOTAL_PAGES; p++) {
  const pageNum = p + 1
  const start = p * LINES_PER_PAGE
  const pageLines = selectedLines.slice(start, start + LINES_PER_PAGE)
  pages.push({
    pageNum,
    lines: pageLines
  })
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${SOFTWARE_NAME} ${VERSION} 源代码鉴别材料</title>
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    background: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .page {
    width: 210mm;
    height: 297mm;
    margin: 20px auto;
    background: #fff;
    padding: 16mm 20mm 15mm 20mm;
    position: relative;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    page-break-after: always;
  }
  @media print {
    body {
      background: none;
    }
    .page {
      margin: 0;
      box-shadow: none;
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      page-break-inside: avoid;
    }
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #222;
    padding-bottom: 6px;
    margin-bottom: 10px;
    font-size: 10.5pt;
    font-family: "SimSun", "STSong", "Songti SC", serif;
    font-weight: bold;
    color: #111;
  }
  .code-container {
    height: 242mm;
    overflow: hidden;
  }
  pre.code {
    font-family: "Consolas", "Courier New", monospace;
    font-size: 8.8pt;
    line-height: 1.37;
    color: #000;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .footer {
    position: absolute;
    bottom: 10mm;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 10pt;
    font-family: "SimSun", "STSong", "Songti SC", serif;
    color: #222;
  }
</style>
</head>
<body>
${pages.map(page => `
  <div class="page">
    <div class="header">
      <span>${escapeHtml(SOFTWARE_NAME)}</span>
      <span>${escapeHtml(VERSION)}</span>
    </div>
    <div class="code-container">
      <pre class="code">
${page.lines.map(l => escapeHtml(l)).join('\n')}
      </pre>
    </div>
    <div class="footer">第 ${page.pageNum} 页 共 ${TOTAL_PAGES} 页</div>
  </div>
`).join('\n')}
</body>
</html>
`

const outDir = path.resolve(process.cwd(), 'outputs')
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

const htmlPath = path.join(outDir, '软著源程序_60页.html')
fs.writeFileSync(htmlPath, html, 'utf-8')
console.log(`Generated HTML at: ${htmlPath}`)

async function exportPdf() {
  console.log('Launching headless browser to render PDF...')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  const pdfPath = path.join(outDir, '软著源程序_60页.pdf')
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 }
  })
  await browser.close()
  console.log(`Generated PDF at: ${pdfPath}`)
}

exportPdf().catch(err => {
  console.error('PDF export failed:', err)
  process.exit(1)
})
