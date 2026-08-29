// 分类分享页渲染核自测脚本（v2 卡片网格）：
// 直接 import share-render.ts 验证输出（node --experimental-strip-types 运行）
//   node --experimental-strip-types scripts/verify_share_category_render.ts
import { renderShareCategoryPage, renderSharePage } from "../functions/_lib/share-render.ts"
import { writeFileSync } from "node:fs"

const category = {
  id: "cat_design",
  name: "设计资源",
  icon: "star", // 非 http(s) → 回退首字母（跨用户图标键不可信）
  color: "#B45309",
}

const groups = [
  {
    id: "g1",
    name: "配色工具",
    notes: '<h2>常用</h2><p>正文 <strong>加粗</strong>，内联 <span class="group-inline-card" data-bm-id="b1"><span class="gic-name">Coolors</span><span class="gic-domain">coolors.co</span></span></p>',
    bookmark_ids: ["b1", "b2", "ghost"],
    updated_at_num: 1755948000000,
    icon: "",
  },
  { id: "g2", name: "空组（无书签无笔记）", notes: "", bookmark_ids: [], updated_at_num: 0, icon: "" },
]

// E2E 三段密文样本：salt(44) + iv(16) + data(≥24)，全 B64 字符（与 crypto.isThreePartCipher 判定一致）
const C1 = "A".repeat(44) + "." + "B".repeat(16) + "." + "C".repeat(32)

const bookmarks = [
  { id: "b1", title: "Coolors", url: "https://coolors.co/", notes: "超好用的配色生成器" },
  { id: "b2", title: "", url: "https://www.figma.com/", notes: "" }, // 空标题 → 回退域名
  { id: "b3", title: "子书签（不应单独成卡）", url: "https://example.com/sub", notes: "", parent_id: "b4" },
  { id: "b4", title: "散落书签父", url: "https://example.com/", notes: "父书签笔记" },
  { id: "b5", title: '带引号 "x" & <tag>', url: "javascript:alert(1)", notes: "<script>alert(1)</script>" },
  { id: "b6", title: "重复引用（g1 已含 b1）", url: "https://coolors.co/palettes", notes: "" },
  // E2E 历史密文（旧版加密过 notes/title，云端遗留 salt.iv.data 三段）：分享侧无 key 必须降级占位，绝不外泄密文串
  { id: "b7", title: "密文备注书签", url: "https://example.com/cipher", notes: C1, parent_id: "" },
  { id: "b8", title: C1, url: "https://example.com/cipher-title", notes: "明文备注", parent_id: "" },
]

const shareUrl = "https://ulink.ren/s/c/cat_share_test"
const origin = "https://ulink.ren"

const zh = renderShareCategoryPage(
  category as never,
  groups as never,
  bookmarks as never,
  "cat_share_test",
  shareUrl,
  origin,
  "zh-CN",
)
const en = renderShareCategoryPage(
  category as never,
  groups as never,
  bookmarks as never,
  "cat_share_test",
  shareUrl,
  origin,
  "en-US",
)
// 分类色非法 → 不注入 CSS 变量（杜绝 CSS 注入）
const evilColor = renderShareCategoryPage(
  { ...category, color: "url(https://evil.com/x.png)" } as never,
  groups as never,
  bookmarks as never,
  "cat_share_test",
  shareUrl,
  origin,
  "zh-CN",
)
// 列表 / 小宫格布局（?layout=list|mini-grid）
const zhList = renderShareCategoryPage(
  category as never,
  groups as never,
  bookmarks as never,
  "cat_share_test",
  shareUrl,
  origin,
  "zh-CN",
  "list",
)
const zhMini = renderShareCategoryPage(
  category as never,
  groups as never,
  bookmarks as never,
  "cat_share_test",
  shareUrl,
  origin,
  "zh-CN",
  "mini-grid",
)
// 空分类：无组无书签
const empty = renderShareCategoryPage(
  category as never,
  [] as never,
  [] as never,
  "cat_share_test",
  shareUrl,
  origin,
  "zh-CN",
)

// 产物落盘（与根目录 verify_*.html 同例），人工/浏览器可直接打开核对视觉
writeFileSync("verify_sc_zh.html", zh)
writeFileSync("verify_sc_en.html", en)
writeFileSync("verify_sc_empty.html", empty)

let failed = 0
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); failed++ } else { console.log("ok:", msg) }
}

// ── 1. Hero ──
assert(zh.includes('class="cat-hero" style="--cat: #B45309"'), "Hero 注入合法分类色 CSS 变量")
assert(zh.includes('<h1 class="cat-hero-name">设计资源</h1>'), "Hero 分类名")
assert(zh.includes('class="cat-hero-accent"'), "Hero accent 竖条（分类色）")
assert(zh.includes('href="https://ulink.ren/#share/c/cat_share_test"'), "CTA 跳 App hash 路由")
// 计数口径：组内 2（b1/b2）+ 散落顶层 5（b4/b5/b6/b7/b8）+ 子书签 1（b3）；ghost 不存在不计
assert(zh.includes('<span class="meta-tag">8 个书签</span>'), "计数=组内2+散落5+子书签1（全部显示）")
assert(zh.includes('<span class="meta-tag">2 个组</span>'), "组计数标签")
assert(zh.includes('class="hero-fb"'), "非 URL 图标 → 首字母回退")

// ── 2. 卡片网格：组在前，散落在后 ──
assert(zh.includes('<div class="cat-grid">'), "网格容器")
const gcardCount = (zh.match(/<article class="gcard">/g) || []).length
const bmcardCount = (zh.match(/<article class="bmcard/g) || []).length
assert(gcardCount === 2, `组卡 2 张（实际 ${gcardCount}）`)
assert(bmcardCount === 5, `散落书签卡 5 张（实际 ${bmcardCount}）`)
assert(zh.indexOf('<article class="gcard">') < zh.indexOf('<article class="bmcard'), "组卡排在散落书签卡之前")
assert(zh.includes(".cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"), "网格参数对齐 App card-grid")

// ── 3. 组内书签 / 子书签 / 去重 ──
assert(zh.includes('class="gcard-title">配色工具</span>'), "组卡标题")
assert(zh.includes('<span class="gcard-count">2 个书签</span>'), "组卡书签计数（ghost 不存在已剔除）")
assert(zh.includes('<input type="checkbox" class="gcard-toggle" id="gcat-0"'), "组卡 checkbox（无 JS 可展开）")
assert(zh.includes('<label class="gcard-head" for="gcat-0"'), "label 绑定 checkbox")
assert(zh.includes('.gcard:has(.gcard-toggle:checked){grid-column:1/-1;height:auto}'), "展开跨整行 CSS")
assert(zh.includes('class="bm" href="https://coolors.co/"'), "组内书签 b1 在组卡内")
assert(!zh.includes('class="bmcard-title">Coolors</span>'), "组内书签不重复出现在散落区")
assert(zh.includes('class="bmcard-title">散落书签父</span>'), "散落父书签成卡")
assert(zh.includes('class="bmcard-notes">父书签笔记</p>'), "散落卡渲染 notes")

// ── 3.5 子书签：全部保留显示，挂在父卡内缩进（不丢数据）──
const childCount = (zh.match(/<a class="bmcard-child"/g) || []).length
assert(childCount === 1, `子书签行 1 条（实际 ${childCount}）`)
assert(zh.includes('class="bmcard-child-title">子书签（不应单独成卡）</span>'), "子书签标题完整显示")
assert(zh.includes('<article class="bmcard has-children">'), "有子项的父卡打 has-children")
assert(zh.includes('<input type="checkbox" class="bmcard-toggle-input" id="bmc-b4">'), "子书签展开 checkbox（无 JS 可展开）")
assert(zh.includes('<label class="bmcard-toggle-label" for="bmc-b4">'), "展开条 label 绑定 checkbox")
assert(zh.includes(">1 个子书签</span>"), "展开条计数文案")
assert(zh.includes('.bmcard:has(.bmcard-toggle-input:checked){grid-column:1/-1;height:auto}'), "勾选 → 跨行展开（折叠仍 232px 等高）")
assert(zh.includes('.bmcard-toggle-input:checked~.bmcard-children{display:flex}'), "勾选 → 子项区显示")
assert(zh.includes('style="padding-left:10px"'), "depth=1 子书签缩进 10px")
assert(zh.includes('<div class="bmcard-children">'), "子书签区容器")
assert(!zh.includes('class="bmcard-badge"'), "非孤儿子书签不打「子书签」角标")
assert(zh.includes("color:var(--cat,#122E8A)"), "子书签图标沿用分类色")
assert(zh.includes('class="focus-notes gcard-nonotes">暂无笔记</div>'), "空组回退「暂无笔记」")
assert(zh.includes('class="gcard-empty">这个组还没有书签</div>'), "空组展开态回退")

// ── 4. 安全 ──
assert(!zh.includes("javascript:alert(1)"), "危险 scheme 不进 href（fixUrl 剥为空）")
assert(zh.includes('class="bmcard-main" href="#"'), "危险 scheme 降级为 #（不跳页内锚点）")
assert(zh.includes('<p class="bmcard-notes">&lt;script&gt;alert(1)&lt;/script&gt;</p>'), "书签 notes 按纯文本转义")
assert(zh.includes('class="bmcard-title">带引号 &quot;x&quot; &amp; &lt;tag&gt;</span>'), "标题 HTML 转义")
assert(evilColor.includes('class="cat-hero"') && !evilColor.includes("--cat:"), "非法分类色不注入（CSS 注入防护）")
assert(zh.includes('href="https://coolors.co/" target="_blank" rel="noopener nofollow"'), "书签链接安全 rel/target")
assert(zh.includes('class="group-inline-card" data-bm-id="b1" href="https://coolors.co/"'), "组 notes 内联书签转可点击 a")

// ── 4.5 E2E 历史密文降级（M15：分享侧无 key，密文绝不外泄，降级为占位）──
assert(!zh.includes(C1), "密文串绝不渲染进页面（notes/title 均降级）")
assert(zh.includes('class="bmcard-title">（内容已加密）</span>'), "title 密文 → 占位标题")
assert(zh.includes('class="bmcard-notes">（内容已加密）</p>'), "notes 密文 → 占位备注")
assert(en.includes('> (encrypted content) <') || en.includes("(encrypted content)"), "en 占位文案")
assert(!zh.includes("https://" + C1), "密文不派生可跳转链接")
const zhGrpCipher = renderSharePage(
  { id: "gc", name: "密文组", notes: C1 } as never,
  [{ id: "gb", title: C1, url: "https://example.com/g", notes: "" }] as never,
  shareUrl,
  origin,
  "zh-CN",
)
assert(!zhGrpCipher.includes(C1), "组分享页同样不渲染密文（组 notes 与书签 title）")
assert(zhGrpCipher.includes("（内容已加密）"), "组分享页密文 → 占位")

// ── 5. SEO head / 双语 ──
assert(zh.includes("<title>设计资源 - ulink</title>"), "title 含分类名")
assert(zh.includes('content="8 个书签 · 2 个组 · 由与链公开分享"'), "zh 描述（分类口径）")
assert(zh.includes('<link rel="canonical" href="https://ulink.ren/s/c/cat_share_test">'), "canonical 同域")
assert(en.includes("8 bookmarks · 2 groups · publicly shared via ulink"), "en 描述")
assert(en.includes("Show / hide bookmarks in this group"), "en 展开提示")
assert(en.includes('<span class="gcard-count">2 bookmarks</span>'), "en 组计数复数")

// ── 6. 空态 / 单数 ──
assert(empty.includes('<div class="empty">这个分享分类还没有书签</div>'), "空分类空态")
assert(!empty.includes('<div class="cat-grid">'), "空分类不渲染空网格")
assert(!empty.includes('<span class="meta-tag">0 个组</span>'), "0 组不显示组标签")

// ── 7. 无 JS 可用（布局不再依赖 JS）──
assert(!zh.includes('class="layout"') && !zh.includes('class="bm-list"'), "分类页不再依赖组分享的双列布局")
assert(zh.includes("html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}"), "样式表内联")

// ── 8. 与主站卡片样式对齐（tokens：--radius-lg 14px / --shadow-card / 232px /
//        padding 16 16 10 / card-name 0.9rem / card-domain 0.72rem / card-notes 0.85rem）──
assert(zh.includes('.gcard,.bmcard{position:relative;height:232px'), "卡片高度 232px 对齐主站 .card")
assert(zh.includes('border-radius:14px'), "圆角 14px 对齐 --radius-lg")
assert(zh.includes('box-shadow:0 1px 3px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.02)'), "卡片阴影对齐 --shadow-card")
assert(zh.includes('.gcard{padding:16px 16px 10px}'), "组卡 padding 16 16 10 对齐 .card")
assert(zh.includes('padding:16px 16px 10px;text-decoration:none'), "散落卡 padding 16 16 10 对齐 .card")
assert(zh.includes('@keyframes scardIn'), "入场动画（主站 cardIn 同感）")
assert(zh.includes('transform:translateY(-3px)'), "hover 上浮 -3px 对齐主站")
assert(zh.includes('font-size:14px;font-weight:600;line-height:18px'), "标题 0.9rem/600/18px 对齐 .card-name")
assert(zh.includes('font-size:11.5px;line-height:18px;color:#8A847C;font-family:ui-monospace'), "域名 0.72rem mono 对齐 .card-domain")
assert(zh.includes('font-size:13.6px'), "笔记 0.85rem 对齐 .card-notes")
assert(zh.includes('.gcard-icon{width:38px;height:38px') && zh.includes('.gcard-icon{width:38px'), "logo 38px 对齐 .card-logo")
assert(zh.includes('border-radius:10px;overflow:hidden;position:relative}'), "logo 圆角 10px 对齐 --radius-md")

// ── 9. 三布局（宫格 / 列表 / 小宫格，对齐主站 uiStore.layoutMode）──
assert(zh.includes('class="cat-layout-switch"'), "布局切换器存在")
assert(zh.includes('href="https://ulink.ren/s/c/cat_share_test?layout=grid"'), "grid 切换链接")
assert(zh.includes('href="https://ulink.ren/s/c/cat_share_test?layout=list"'), "list 切换链接")
assert(zh.includes('href="https://ulink.ren/s/c/cat_share_test?layout=mini-grid"'), "mini-grid 切换链接")
assert(zh.includes('cat-layout-btn active'), "当前布局按钮高亮")
assert(zh.includes('cat-layout-btn active hide-mobile'), "宫格按钮（当前项）带移动端隐藏标记")
assert(zh.includes('@media(max-width:768px){.cat-layout-btn.hide-mobile{display:none}}'), "移动端 CSS 只留列表/小宫格")
assert(zh.includes('<div class="cat-grid">'), "默认 grid 布局容器")
assert(zhList.includes('<div class="cat-grid list-view">'), "list 布局容器挂 list-view 类")
assert(zhList.includes('.cat-grid.list-view{display:flex;flex-direction:column;gap:8px'), "list 容器规则对齐主站（flex column gap 8）")
assert(zhList.includes('.cat-grid.list-view .gcard:not(.is-open),.cat-grid.list-view .bmcard:not(.is-open){height:82px'), "list 折叠 82px 对齐主站")
assert(zhList.includes('class="cat-layout-btn active"') && zhList.includes('?layout=list"'), "list 页面当前项为 list")
assert(zhMini.includes('<div class="cat-grid mini-grid-view">'), "mini-grid 容器挂 mini-grid-view 类")
assert(zhMini.includes('.cat-grid.mini-grid-view{display:block;column-gap:10px;column-fill:balance;column-width:clamp(140px,11vw,200px)}'), "mini-grid 瀑布流容器对齐主站")
assert(zhMini.includes('.cat-grid.mini-grid-view .bmcard-notes'), "mini-grid 隐藏备注/组笔记/计数/展开条")
assert(zhMini.includes('class="cat-layout-btn active"') && zhMini.includes('?layout=mini-grid"'), "mini-grid 页面当前项为 mini-grid")

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS")
process.exitCode = failed ? 1 : 0
