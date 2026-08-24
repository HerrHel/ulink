// 渲染核自测脚本：直接 import share-render.ts 验证输出（node --experimental-strip-types 运行）
import { renderSharePage, renderNotFoundPage } from "../functions/_lib/share-render.ts"

const richNotes =
  "<p>第一段 <strong>加粗</strong> 与 <em>斜体</em>，还有 <a href=\"https://example.com/x\">链接</a>。</p>" +
  "<h2>二级标题</h2><ul><li>列表项 A</li><li>列表项 B</li></ul>" +
  '<p><span class="group-inline-card" data-bm-id="b1" contenteditable="false"><img src="https://api.xinac.net/icon/?url=example.com" alt=""><span class="gic-name">内联书签</span></span></p>' +
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox"><span></span></label><div>已完成任务</div></li></ul>'

const group = {
  id: "testgid123",
  name: "前端资源精选",
  notes: richNotes,
  updated_at_num: 1755948000000,
  icon: "",
}
const bookmarks = [
  { id: "b1", title: "联想异常修复", url: "https://www.kdocs.cn/l/chkUaTa2a2K7", notes: "旧备注（列表模式不显示）" },
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

// ── 1. 白卡聚焦结构 ──
assert(zh.includes('class="focus-card"'), "focus-card 白卡容器")
assert(zh.includes('class="focus-accent"'), "accent 竖条")
assert(zh.includes('<h1 class="focus-name">前端资源精选</h1>'), "组名")
assert(zh.includes('class="focus-meta"'), "meta 标签区")
assert(zh.includes("更新于") && zh.includes("2025-08-23"), "updatedAt tag + 日期")
assert(zh.includes("2 个链接") || zh.includes("4 个链接"), "count tag")
// CTA 在 focus-head 内（右上）：focus-head 闭合前有 cta
assert(/focus-head[\s\S]*<a class="cta"/.test(zh), "CTA 位于 focus-head 内（右上）")
assert(!/list-foot/.test(zh), "旧底部 CTA 区已移除")
// 书签列表
assert(zh.includes('class="bm-list"'), "bm-list 容器")
assert(zh.includes('class="bm" href="https://www.kdocs.cn/l/chkUaTa2a2K7"'), "书签链接")
assert(zh.includes("kdocs.cn"), "域名")
assert(zh.includes("workbuddy.cn"), "空标题回退域名")
// 等高：列表模式不显示 notes
assert(!zh.includes("旧备注（列表模式不显示）"), "列表模式不渲染书签 note（等高）")

// ── 2. 富文本 sanitizer ──
// 白名单标签保留
assert(zh.includes("<strong>加粗</strong>"), "strong 保留")
assert(zh.includes("<em>斜体</em>"), "em 保留")
assert(zh.includes("<h2>二级标题</h2>"), "h2 保留")
assert(zh.includes("<ul><li>列表项 A</li><li>列表项 B</li></ul>"), "ul/li 保留")
assert(zh.includes('href="https://example.com/x" target="_blank" rel="noopener noreferrer nofollow"'), "a 强制安全 rel/target")
// inline card：class/data-* 保留、contenteditable 剥除、favicon src 保留
assert(zh.includes('class="group-inline-card" data-bm-id="b1"'), "inline-card class/data-bm-id 保留")
assert(!zh.includes("contenteditable"), "contenteditable 剥除")
assert(zh.includes('src="https://api.xinac.net/icon/?url=example.com"'), "inline-card favicon src 保留（https）")
// taskList：data-type/data-checked 保留、input/label/div 剥除
assert(zh.includes('data-type="taskItem" data-checked="true"'), "taskItem data-* 保留")
assert(!zh.includes("<input"), "input 剥除")
assert(!zh.includes("<label>"), "label 剥除")
assert(!zh.includes("<div>已完成任务</div>"), "div 剥除（文本残留）")
assert(zh.includes("已完成任务"), "task 文本保留")

// ── 3. XSS 剥离 ──
const evilNotes =
  '<p onclick="x()">安全文本</p>' +
  '<a href="javascript:alert(1)">坏链</a>' +
  '<img src="data:image/png;base64,AAAA" onerror="alert(2)">' +
  '<span style="color:red">样式</span>' +
  "<script>alert('xss')</script>" +
  "<style>body{display:none}</style>" +
  '<iframe src="https://evil.com"></iframe>' +
  '<svg onload="alert(3)"></svg>' +
  '<p data-evil-attr="1">属性</p>' +
  '<img src="https://ok.example/a.png" onload="bad()">'
const zhEvil = renderSharePage({ ...group, notes: evilNotes } as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
// focus-notes 区段（用户可控 notes 的落点）才是判定范围；页面自身 logo/箭头为 <svg>、书签 favicon 有合法 onerror
const evilNotesSection = zhEvil.match(/<div class="focus-notes">([\s\S]*?)<\/div>/)?.[1] || ""
assert(!evilNotesSection.includes("alert(") && !zhEvil.includes('content="安全文本坏链样式alert('), "script 内容整块删除（含 meta 描述）")
assert(!zhEvil.includes("javascript:alert"), "javascript: href 剥离")
assert(!evilNotesSection.includes("data:image"), "data: img src 剥离")
assert(!evilNotesSection.includes("onerror") && !evilNotesSection.includes("onload") && !evilNotesSection.includes("onclick"), "notes 内 on* 事件属性剥离")
assert(!evilNotesSection.includes("style="), "notes 内 style 属性剥离")
assert(!evilNotesSection.includes("<iframe") && !evilNotesSection.includes("</iframe>"), "iframe 剥离")
assert(!evilNotesSection.includes("<svg") && !evilNotesSection.includes("</svg>"), "notes 内 svg 剥离")
assert(zhEvil.includes("data-evil-attr"), "data-* 整族放行（与 App sanitizeReadonlyHTML 语义一致）")
assert(!evilNotesSection.includes("body{display:none}") && !zhEvil.includes('content="安全文本坏链样式alert(1)body{displ'), "style 块内容删除（含 meta 描述）")
assert(evilNotesSection.includes("安全文本") && evilNotesSection.includes("坏链"), "正常文本保留")

// ── 4. favicon / :has() 修复 ──
// fallback 在 img 之前（img 后绘制盖住？不——用 :has() 控制显隐，顺序无关；断言结构存在）
assert(zh.includes('class="bm-fb"'), "bm 首字母 fallback 存在")
assert(zh.includes("bm-icon:has(img:not(.img-err)) .bm-fb{display:none}"), ":has() 修复 CSS 存在")
assert(zh.includes("onerror=\"this.classList.add('bm-img-err')\""), "bm img onerror 加类（非 display none）")
assert(zh.includes('class="hero-fb"'), "hero 首字母 fallback 存在")
assert(zh.includes("api.xinac.net/icon/"), "favicon provider")
assert(!zh.includes("data-fb onerror=\"this.style.display='none'\""), "旧 display:none 降级移除")

// ── 5. 双语 / 404 ──
assert(en.includes("4 links"), "en count")
assert(en.includes("Updated"), "en updatedAt")
assert(en.includes("Open in ulink"), "en CTA")
assert(en.includes("Collect · Organize · Share"), "en footer")
assert(nf.includes("该分享不存在") && nf.includes("返回与链首页"), "404 zh")
assert(!zh.includes("focus-titlewrap-text") && !zh.includes("hero-notes"), "旧结构类名不残留")

// ── 6. group icon URL / 无时间 ──
const g2 = { ...group, icon: "https://cdn.example.com/icon.png" }
const zh2 = renderSharePage(g2 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(zh2.includes('src="https://cdn.example.com/icon.png"'), "group icon URL 渲染")
const g3 = { ...group, icon: "star" }
const zh3 = renderSharePage(g3 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(!zh3.includes("src=\"star\"") && zh3.includes("hero-fb"), "group icon 非 URL 回退首字母")
const g4 = { ...group, updated_at_num: 0 }
const zh4 = renderSharePage(g4 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(!zh4.includes("更新于"), "无时间不显示 updatedAt")

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS")
process.exitCode = failed ? 1 : 0
