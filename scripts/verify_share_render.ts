// 渲染核自测脚本（临时）：直接 import share-render.ts 验证输出
import { renderSharePage, renderNotFoundPage } from "../functions/_lib/share-render.ts"

const group = {
  id: "testgid123",
  name: "前端资源精选",
  notes: "<p>收集的前端开发资源，持续更新中。</p>",
  updated_at_num: 1755948000000,
  icon: "",
}
const bookmarks = [
  { id: "b1", title: "联想异常修复", url: "https://www.kdocs.cn/l/chkUaTa2a2K7", notes: "永久VIP" },
  { id: "b2", title: "", url: "https://www.workbuddy.cn/", notes: "" },
  { id: "b3", title: "bad scheme", url: "javascript:alert(1)", notes: "should be stripped" },
  { id: "b4", title: "带引号的标题 \"quoted\" & <tag>", url: "https://example.com/a?b=1&c=2", notes: "esc & < >" },
]

const zh = renderSharePage(group as never, bookmarks as never, "https://ulink.ren/s/testgid123", "https://ulink.ren", "zh-CN")
const en = renderSharePage(group as never, bookmarks as never, "https://ulink.ren/s/testgid123", "https://ulink.ren", "en-US")
const nf = renderNotFoundPage("zh-CN")

import { writeFileSync } from "node:fs"
writeFileSync("verify_s_new_zh.html", zh)
writeFileSync("verify_s_new_en.html", en)
writeFileSync("verify_s_new_404.html", nf)

// ── 断言 ──
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1 } else { console.log("ok:", msg) }
}

// 结构
assert(zh.includes('<h1 class="hero-name">前端资源精选</h1>'), "hero-name 渲染")
assert(zh.includes("更新于"), "zh updatedAt tag")
assert(zh.includes("2025-08-23"), "日期格式 YYYY-MM-DD")
assert(zh.includes("2 个链接") || zh.includes("4 个链接"), "count tag")
assert(zh.includes('class="meta-tag"'), "meta tag")
assert(zh.includes("footer-slogan") || zh.includes("foot-slogan"), "footer slogan")
assert(zh.includes("收藏 · 整理 · 分享"), "zh footer slogan text")
assert(zh.includes('· ulink'), "footer brand")
assert(en.includes("Collect · Organize · Share"), "en footer slogan")
assert(en.includes("Updated"), "en updatedAt")
assert(en.includes("4 links"), "en count")
// 书签行
assert(zh.includes('class="bm" href="https://www.kdocs.cn/l/chkUaTa2a2K7"'), "书签链接")
assert(zh.includes("kdocs.cn"), "域名")
assert(zh.includes("永久VIP"), "note")
assert(zh.includes("workbuddy.cn"), "空标题回退域名")
// 危险 scheme：javascript: 被拒 → href="#" 且无 favicon
assert(zh.includes('href="#"') && zh.includes("bad scheme"), "危险 scheme 降级 #")
// 转义
assert(zh.includes("&quot;quoted&quot;") || zh.includes("&#34;quoted&#34;"), "标题引号转义")
assert(zh.includes("&amp;") && zh.includes("&lt;tag&gt;"), "& < 转义")
assert(!zh.includes("&c=2"), "URL 属性转义（& → &amp;）")
// favicon
assert(zh.includes("api.xinac.net/icon/"), "favicon provider")
assert(zh.includes('data-fb'), "favicon fallback 标记")
assert(zh.includes("onerror"), "onerror 降级")
// 脚本
assert(zh.includes("FALLBACK_JS") === false && zh.includes("naturalWidth"), "内联降级脚本")
// 404
assert(nf.includes("该分享不存在"), "404 heading zh")
assert(nf.includes("返回与链首页"), "404 back home")
// 旧类名不应残留
assert(!zh.includes("focus-card") && !zh.includes("focus-accent"), "旧卡片结构已移除")
// 危险 URL 无 favicon（b3 javascript: → faviconOf 空）
assert(!/api\.xinac\.net\/icon\/\?url=javascript/.test(zh), "危险 scheme 不派生 favicon")
// group icon：http(s) URL 渲染 img，非 URL 回退首字母
const g2 = { ...group, icon: "https://cdn.example.com/icon.png" }
const zh2 = renderSharePage(g2 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(zh2.includes('src="https://cdn.example.com/icon.png"'), "group icon URL 渲染")
const g3 = { ...group, icon: "star" }
const zh3 = renderSharePage(g3 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(!zh3.includes("src=\"star\"") && zh3.includes("hero-fb"), "group icon 非 URL 回退首字母")
// 无 updated_at_num
const g4 = { ...group, updated_at_num: 0 }
const zh4 = renderSharePage(g4 as never, bookmarks as never, "https://ulink.ren/s/x", "https://ulink.ren", "zh-CN")
assert(!zh4.includes("更新于"), "无时间不显示 updatedAt")

console.log("done; files: verify_s_new_zh.html / verify_s_new_en.html / verify_s_new_404.html")
