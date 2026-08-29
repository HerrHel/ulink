// 分类分享页渲染核自测脚本（v2 卡片网格）：
// 直接 import share-render.ts 验证输出（node --experimental-strip-types 运行）
//   node --experimental-strip-types scripts/verify_share_category_render.ts
import { renderShareCategoryPage } from "../functions/_lib/share-render.ts"
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

const bookmarks = [
  { id: "b1", title: "Coolors", url: "https://coolors.co/", notes: "超好用的配色生成器" },
  { id: "b2", title: "", url: "https://www.figma.com/", notes: "" }, // 空标题 → 回退域名
  { id: "b3", title: "子书签（不应单独成卡）", url: "https://example.com/sub", notes: "", parent_id: "b4" },
  { id: "b4", title: "散落书签父", url: "https://example.com/", notes: "父书签笔记" },
  { id: "b5", title: '带引号 "x" & <tag>', url: "javascript:alert(1)", notes: "<script>alert(1)</script>" },
  { id: "b6", title: "重复引用（g1 已含 b1）", url: "https://coolors.co/palettes", notes: "" },
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
// 计数口径：组内 2（b1/b2）+ 散落 3（b4 父书签 / b5 危险链接 / b6 未入组）；b3 子书签、ghost 不存在均不计
assert(zh.includes('<span class="meta-tag">5 个书签</span>'), "计数=组内2+散落3（子书签与不存在 id 不计）")
assert(zh.includes('<span class="meta-tag">2 个组</span>'), "组计数标签")
assert(zh.includes('class="hero-fb"'), "非 URL 图标 → 首字母回退")

// ── 2. 卡片网格：组在前，散落在后 ──
assert(zh.includes('<div class="cat-grid">'), "网格容器")
const gcardCount = (zh.match(/<article class="gcard">/g) || []).length
const bmcardCount = (zh.match(/<a class="bmcard"/g) || []).length
assert(gcardCount === 2, `组卡 2 张（实际 ${gcardCount}）`)
assert(bmcardCount === 3, `散落书签卡 3 张（实际 ${bmcardCount}）`)
assert(zh.indexOf('<article class="gcard">') < zh.indexOf('<a class="bmcard"'), "组卡排在散落书签卡之前")
assert(zh.includes(".cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"), "网格参数对齐 App card-grid")

// ── 3. 组内书签 / 子书签 / 去重 ──
assert(zh.includes('class="gcard-title">配色工具</span>'), "组卡标题")
assert(zh.includes('<span class="gcard-count">2 个书签</span>'), "组卡书签计数（ghost 不存在已剔除）")
assert(zh.includes('<input type="checkbox" class="gcard-toggle" id="gcat-0"'), "组卡 checkbox（无 JS 可展开）")
assert(zh.includes('<label class="gcard-head" for="gcat-0"'), "label 绑定 checkbox")
assert(zh.includes('.gcard:has(.gcard-toggle:checked){grid-column:1/-1;height:auto}'), "展开跨整行 CSS")
assert(zh.includes('class="bm" href="https://coolors.co/"'), "组内书签 b1 在组卡内")
assert(zh.includes("b1 已在组内 → 不重复出现在散落区") || !zh.includes('class="bmcard-title">Coolors</span>'), "组内书签不重复成散落卡")
assert(!zh.includes('class="bmcard-title">子书签（不应单独成卡）</span>'), "子书签不单独成卡")
assert(zh.includes('class="bmcard-title">散落书签父</span>'), "散落父书签成卡")
assert(zh.includes('class="bmcard-notes">父书签笔记</p>'), "散落卡渲染 notes")
assert(zh.includes('class="focus-notes gcard-nonotes">暂无笔记</div>'), "空组回退「暂无笔记」")
assert(zh.includes('class="gcard-empty">这个组还没有书签</div>'), "空组展开态回退")

// ── 4. 安全 ──
assert(!zh.includes("javascript:alert(1)"), "危险 scheme 不进 href（fixUrl 剥为空）")
assert(zh.includes('class="bmcard" href="#"'), "危险 scheme 降级为 #（不跳页内锚点）")
assert(zh.includes('<p class="bmcard-notes">&lt;script&gt;alert(1)&lt;/script&gt;</p>'), "书签 notes 按纯文本转义")
assert(zh.includes('class="bmcard-title">带引号 &quot;x&quot; &amp; &lt;tag&gt;</span>'), "标题 HTML 转义")
assert(evilColor.includes('class="cat-hero"') && !evilColor.includes("--cat:"), "非法分类色不注入（CSS 注入防护）")
assert(zh.includes('href="https://coolors.co/" target="_blank" rel="noopener nofollow"'), "书签链接安全 rel/target")
assert(zh.includes('class="group-inline-card" data-bm-id="b1" href="https://coolors.co/"'), "组 notes 内联书签转可点击 a")

// ── 5. SEO head / 双语 ──
assert(zh.includes("<title>设计资源 - ulink</title>"), "title 含分类名")
assert(zh.includes('content="5 个书签 · 2 个组 · 由与链公开分享"'), "zh 描述（分类口径）")
assert(zh.includes('<link rel="canonical" href="https://ulink.ren/s/c/cat_share_test">'), "canonical 同域")
assert(en.includes("5 bookmarks · 2 groups · publicly shared via ulink"), "en 描述")
assert(en.includes("Show / hide bookmarks in this group"), "en 展开提示")
assert(en.includes('<span class="gcard-count">2 bookmarks</span>'), "en 组计数复数")

// ── 6. 空态 / 单数 ──
assert(empty.includes('<div class="empty">这个分享分类还没有书签</div>'), "空分类空态")
assert(!empty.includes('<div class="cat-grid">'), "空分类不渲染空网格")
assert(!empty.includes('<span class="meta-tag">0 个组</span>'), "0 组不显示组标签")

// ── 7. 无 JS 可用（布局不再依赖 JS）──
assert(!zh.includes('class="layout"') && !zh.includes('class="bm-list"'), "分类页不再依赖组分享的双列布局")
assert(zh.includes("html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}"), "样式表内联")

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS")
process.exitCode = failed ? 1 : 0
