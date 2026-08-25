// 渲染核自测脚本：直接 import share-render.ts 验证输出（node --experimental-strip-types 运行）
import { renderSharePage, renderNotFoundPage } from "../functions/_lib/share-render.ts"

const richNotes =
  "<h1>文档总标题</h1>" +
  "<p>第一段 <strong>加粗</strong> 与 <em>斜体</em>，还有 <a href=\"https://example.com/x\">链接</a>。</p>" +
  "<p>这段有 <span style=\"color: rgb(190, 18, 60)\">红字</span>、<span style=\"color: #0d7a6f\">青字</span>、<mark data-color=\"#ffd666\" style=\"background-color: rgb(255, 214, 102); color: inherit\">高亮底</mark>、<span style=\"font-size: 18px\">大字号</span>。</p>" +
  '<p style="text-align: center">居中段落</p>' +
  "<h2>二级标题</h2><ul><li>列表项 A</li><li>列表项 B</li></ul>" +
  "<h3>三级小节</h3><p>小节内容</p>" +
  '<p>内联书签：<span class="group-inline-card" contenteditable="false" draggable="true" data-bm-id="b1"><img src="https://api.xinac.net/icon/?url=kdocs.cn" alt=""><span class="gic-name">联想异常修复</span><span class="gic-domain">kdocs.cn</span><span class="gic-btn">详</span></span> 与 <span class="group-inline-card" data-bm-id="ghost"><span class="gic-name">不存在书签</span><span class="gic-domain">ghost.example</span></span>、组引用 <span class="group-inline-card group-ref-card" data-bm-id="ref:g9"><span class="gic-note-icon">i</span><span class="gic-name">子组</span><span class="gic-count">3个书签</span><span class="gic-btn">详</span></span></p>' +
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">已完成任务</li><li data-type="taskItem" data-checked="false">未完成任务</li></ul>'

const group = {
  id: "testgid123",
  name: "前端资源精选",
  notes: richNotes,
  updated_at_num: 1755948000000,
  icon: "",
}
const bookmarks = [
  { id: "b1", title: "联想异常修复", url: "https://www.kdocs.cn/l/chkUaTa2a2K7", notes: "" },
  { id: "b2", title: "", url: "https://www.workbuddy.cn/", notes: "" },
  { id: "b3", title: "bad scheme", url: "javascript:alert(1)", notes: "" },
  { id: "b4", title: "带引号的标题 \"quoted\" & <tag>", url: "https://example.com/a?b=1&c=2", notes: "" },
]

const zh = renderSharePage(group as never, bookmarks as never, "https://ulink.ren/s/testgid123", "https://ulink.ren", "zh-CN")
const en = renderSharePage(group as never, bookmarks as never, "https://ulink.ren/s/testgid123", "https://ulink.ren", "en-US")
const nf = renderNotFoundPage("zh-CN")

import { writeFileSync } from "node:fs"
writeFileSync(".verify_s_new_zh.html", zh)
writeFileSync(".verify_s_new_en.html", en)
writeFileSync(".verify_s_new_404.html", nf)

let failed = 0
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); failed++ } else { console.log("ok:", msg) }
}

// ── 1. 双列布局：白卡左 + 书签列表右 ──
assert(zh.includes('class="focus-card"'), "focus-card 白卡容器")
assert(zh.includes('class="focus-accent"'), "accent 竖条")
assert(zh.includes('<h1 class="focus-name">前端资源精选</h1>'), "组名")
assert(zh.includes('class="focus-meta"'), "meta 标签区")
assert(zh.includes("更新于") && zh.includes("2025-08-23"), "updatedAt tag + 日期")
// CTA 在 focus-head 内（右上）
assert(/focus-head[\s\S]*<a class="cta"/.test(zh), "CTA 位于 focus-head 内（右上）")
// 双列：bm-list 在 focus-card 闭合之后（main 内右侧）
assert(zh.includes('<aside class="bm-list">'), "bm-list 为 aside（卡片外）")
assert(/<\/div>\n<aside class="bm-list">/.test(zh), "bm-list 在 focus-card 之后（右侧竖排）")
assert(zh.includes(".main{width:1000px;flex-shrink:0;display:flex;align-items:flex-start;gap:20px}"), "main 固定 1000px 双列")
assert(zh.includes(".bm-list{width:320px"), "bm-list 固定宽 320px（右侧）")
assert(zh.includes("@media(max-width:920px)"), "窄屏回退单列断点")

// ── 1.5 三区布局：左 TOC 导航 + 内容居中 ──
assert(zh.includes('<nav class="toc" aria-label="目录">'), "TOC 导航渲染（zh）")
assert(zh.includes('<div class="toc-title">目录</div>'), "TOC 标题 zh")
assert(en.includes('<nav class="toc" aria-label="Contents">') && en.includes('<div class="toc-title">Contents</div>'), "TOC 标题 en")
assert(zh.includes('class="toc-item toc-l1" href="#toc-0"') && zh.includes('>文档总标题</a>'), "TOC h1 项（无缩进）")
assert(zh.includes('class="toc-item toc-l2" href="#toc-1"') && zh.includes('>二级标题</a>'), "TOC h2 项（缩进 1 级）")
assert(zh.includes('class="toc-item toc-l3" href="#toc-2"') && zh.includes('>三级小节</a>'), "TOC h3 项（缩进 2 级）")
assert(zh.includes('<h1 id="toc-0">文档总标题</h1>') && zh.includes('<h2 id="toc-1">二级标题</h2>') && zh.includes('<h3 id="toc-2">三级小节</h3>'), "标题注入锚点 id")
assert(zh.includes("scroll-behavior:smooth"), "锚点平滑滚动")
assert(zh.includes(".toc{width:200px;flex-shrink:0;position:sticky"), "TOC sticky 左栏")
assert(zh.includes(".layout{display:flex;gap:24px;align-items:flex-start;justify-content:center}"), "内容区整体居中布局")
assert(zh.includes("@media(max-width:1240px)"), "TOC 窄屏隐藏断点")
// 无数标题的组 → 不渲染 TOC
const gNoToc = { ...group, notes: "<p>只有正文没有标题</p>" }
const zhNoToc = renderSharePage(gNoToc as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(!zhNoToc.includes('<nav class="toc"'), "无数标题不渲染 TOC")

// ── 2. 富文本 sanitizer ──
assert(zh.includes("<strong>加粗</strong>") && zh.includes("<em>斜体</em>"), "strong/em 保留")
assert(zh.includes('<h2 id="toc-1">二级标题</h2>') && zh.includes("<ul><li>列表项 A</li><li>列表项 B</li></ul>"), "h2(带id)/ul/li 保留")
assert(zh.includes('href="https://example.com/x" target="_blank" rel="noopener noreferrer nofollow"'), "a 强制安全 rel/target")
// ── 3. 富文本样式保留（对齐组内 TipTap 渲染：颜色/高亮/字号/对齐）──
assert(zh.includes('style="color: rgb(190, 18, 60)"'), "rgb 文字色保留")
assert(zh.includes('style="color: #0d7a6f"'), "hex 文字色保留")
assert(zh.includes('<mark data-color="#ffd666" style="background-color: rgb(255, 214, 102); color: inherit">高亮底</mark>'), "mark 高亮保留（背景色）")
assert(zh.includes('style="font-size: 18px"'), "font-size 字号保留")
assert(zh.includes('<p style="text-align: center">居中段落</p>'), "text-align 对齐保留")
assert(!zh.includes('style="color: red;'), "style 其他声明剥除")
// ── 4. 内联书签转可点击 <a> ──
assert(zh.includes('<a class="group-inline-card" data-bm-id="b1" href="https://www.kdocs.cn/l/chkUaTa2a2K7" target="_blank" rel="noopener nofollow"'), "内联书签命中 bmMap → 可点击 a")
assert(zh.includes('class="gic-name">联想异常修复</span><span class="gic-domain">kdocs.cn</span>'), "内联书签卡片含 gic-name + gic-domain（与组内一致）")
assert(zh.includes('联想异常修复</span><span class="gic-domain">kdocs.cn</span><span class="gic-btn">详</span></a>'), "内联书签 a 正确闭合（favicon+标题+域名+详全在卡片内）")
assert(zh.includes('class="gic-domain">ghost.example</span>'), "未命中 bmMap 的内联书签保持 span + 域名样式")
assert(zh.includes('class="group-inline-card group-ref-card"') && zh.includes('class="gic-count">3个书签</span>'), "组引用 gic-count 保留")
assert(zh.includes('class="gic-btn">详</span>') && zh.includes(".focus-notes .gic-btn,.focus-notes .gic-remove{display:none}"), "「详」按钮 class 保留 + CSS 隐藏")
assert(zh.includes('rel="noopener nofollow"'), "内联书签 a 安全 rel")
// ── 5. taskItem：checkbox 对齐组内原生样式（伪元素方形勾选）──
assert(zh.includes('data-type="taskItem" data-checked="true"') && zh.includes('data-type="taskItem" data-checked="false"'), "taskItem data-checked 保留")
assert(!zh.includes("<input") && !zh.includes("<label>") && !zh.includes("<div>"), "input/label/div 剥除")
assert(zh.includes("已完成任务") && zh.includes("未完成任务"), "task 文本保留")
assert(zh.includes('li[data-type="taskItem"][data-checked="true"]{text-decoration:line-through'), "勾选划线 CSS")
assert(zh.includes('width:16px;height:16px;box-sizing:border-box;border:1.5px solid #C9C0B4;border-radius:4px'), "checkbox 伪元素方形样式（对齐原生 input checkbox）")
assert(!zh.includes('content:"☐"') && !zh.includes('content:"☑"'), "旧的 ☐/☑ 字符方案移除")
assert(zh.includes("data-checked") && zh.includes("taskItem") && zh.includes("addEventListener('click'"), "taskItem 点击切换 JS")

// ── 6. XSS / 注入剥离 ──
const evilNotes =
  '<p onclick="x()">安全文本</p>' +
  '<a href="javascript:alert(1)">坏链</a>' +
  '<img src="data:image/png;base64,AAAA" onerror="alert(2)">' +
  '<span style="color:red;background:url(https://evil.com/x.png)">样式</span>' +
  '<span style="background:url(javascript:alert(1))">无 color 剥 style</span>' +
  '<span style="font-size: expression(alert(1))">字号注入</span>' +
  '<span style="background-color: url(https://evil.com/y.png)">高亮注入</span>' +
  "<script>alert(1)</script><style>body{display:none}</style>" +
  '<iframe src="https://evil.com"></iframe><svg onload="alert(3)"></svg>' +
  '<span class="group-inline-card" data-bm-id="b1" onclick="steal()"><span class="gic-name">注入卡</span></span>'
const zhEvil = renderSharePage({ ...group, notes: evilNotes } as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
const evilSection = zhEvil.match(/<div class="focus-notes">([\s\S]*?)<\/div>/)?.[1] || ""
assert(!evilSection.includes("alert(") && !zhEvil.includes('content="安全文本坏链样式alert('), "script/style 整块删除（含 meta 描述）")
assert(!zhEvil.includes("javascript:alert"), "javascript: href 剥离")
assert(!evilSection.includes("data:image"), "data: img src 剥离")
assert(!evilSection.includes("onclick") && !evilSection.includes("onerror") && !evilSection.includes("onload"), "notes 内 on* 事件剥离")
assert(!evilSection.includes("background:"), "style background 简写剥除")
assert(!evilSection.includes("url("), "style url() 剥除（color/background/font-size 注入面）")
assert(!evilSection.includes("expression"), "font-size expression 注入剥除")
assert(!evilSection.includes("<iframe") && !evilSection.includes("<svg"), "iframe/svg 剥离")
assert(!evilSection.includes("onclick=\"steal"), "内联书签 a 无事件属性")
assert(evilSection.includes("安全文本"), "正常文本保留")

// ── 7. favicon / :has() / 双语 / 404 ──
assert(zh.includes('class="bm-fb"') && zh.includes("bm-icon:has(img:not(.img-err)) .bm-fb{display:none}"), ":has() 修复 CSS")
assert(en.includes("4 links") && en.includes("Open in ulink"), "en 双语")
assert(nf.includes("该分享不存在") && nf.includes("返回与链首页"), "404 zh")
assert(!zh.includes("hero-notes") && !zh.includes("bm-note"), "旧类名不残留")
assert(zh.includes("api.xinac.net/icon/"), "favicon provider")

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS")
process.exitCode = failed ? 1 : 0
