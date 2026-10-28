# 品牌视觉纪律（Brand & Design Tokens）

> 配套代码：`src/styles/tokens.css`（唯一真源）、`src/lib/theme.ts`（theme-color meta）
> 读者：任何要改 UI 配色/排版/动效的 agent 或开发者。**改前必读，尤其是 §2。**

---

## 1. 品牌签名：四主题四色相（刻意设计，不是漂移）

| 主题 | `--accent` | `--brand-logo-blue` | `--brand-logo-green` | `--text-on-accent` |
|---|---|---|---|---|
| 效率 · 浅色 | `#122E8A` 海军蓝 | `#122E8A` | `#10B981` | `#ffffff` |
| 效率 · 深色 | `#F04A8A` 玫粉 | `#F04A8A` | `#E2E7BF` | `#ffffff` |
| 舒适 · 浅色 | `#2C9678` 绿 | `#122E8A` | `#10B981` | `#ffffff` |
| 舒适 · 深色 | `#E2E7BF` 米白 | `#F04A8A` | `#E2E7BF` | `#262E24` |

**这是站点的识别性签名：浅色 = 工作模式的冷静蓝，暗色 = 夜览模式的活力粉。**
主题切换即情绪切换。不要试图「统一」为跨主题同色相——2026-10-28 曾把暗色改成
蓝色提亮版（品牌色恒定策略），经拍板于 `b0dc1989` 全量回退。结论：

- ✅ 签名色相**只作用于 accent 层**（强调色 / 按钮 / logo / 激活态高亮）
- ✅ 表面（`--surface*`）、文字（`--text*`）、边框（`--border*`）走共享中性色板，主题间同构
- ❌ 不要把粉/米白扩散到非 accent 用途，也不要反过来把它们「修成」蓝色

## 2. 令牌副本同步清单（改 accent 必读）

accent 系令牌存在**四处副本**，改值必须逐字同步，否则主题切换/分享页/SSR 三处观感撕裂：

| # | 位置 | 作用 |
|---|---|---|
| 1 | `src/styles/tokens.css` | 应用内四主题（唯一交互源） |
| 2 | `src/lib/theme.ts` → `THEME_COLOR` | 移动端浏览器状态栏 theme-color meta |
| 3 | `cloudbase/functions/share-ssr/share-render.js` | CloudBase 分享 SSR 壳（需 `node scripts/deploy-cloudbase-fn.mjs share-ssr` 重新部署） |
| 4 | `functions/_lib/share-render.ts` | CF Pages 分享 SSR 壳 |

同步后必须跑：`npx vitest run src/__tests__/lib/theme.test.ts src/__tests__/views/share-render-shell.test.ts`
（两处测试锁定了具体色值字符串）。部署 share-ssr 后用探针 URL 验证线上 HTML 含新值。

另外：落地页 `index.html` 内联 `:root` 是第 5 处**值级**副本（radius/shadow/色板），
与 tokens.css 的 `:root` 块逐字对齐；命名映射见该文件注释（`--ink=--text` 等）。

## 3. 排版与动效阶梯（2026-10-28 收敛后的纪律）

- **字号**：一律用 `--fs-2xs` ~ `--fs-3xl` 九级 token，禁止新造 `0.83rem` 式小数。
  micro 档例外：9/10/11/15px（配固定行高的微型徽章）、`1rem` 正文、`1.6rem` 价格展示。
- **圆角**：`--radius-xs ~ xl` + `--radius-full`；多值圆角与 1px 发丝边可写字面值。
- **动效时长**：3 档 `0.15s / 0.2s / 0.3s`；0.05s 仅用于按压反馈，≥0.45s 仅用于视图过渡/循环动画。
- **语义色**：success 用 `--green`（`--emerald` 是其别名）、danger 用 `--danger`、warning 用
  `--amber`；禁止新引入 Tailwind 原色（`#2563eb` / `#ef4444` 等）。

## 4. 历史决策记录

| 日期 | 决策 | 提交 |
|---|---|---|
| 2026-10-28 | 全站令牌收敛：字阶 42→9 级、时长 10→3 档、圆角/色板去重，卡片去噪 | `d7a40246` |
| 2026-10-28 | 曾试行「品牌色恒定」（暗色改蓝色提亮版）→ 拍板撤销，签名色相恢复 | `b0dc1989` |
| 2026-10-28 | 存量数据迁移：内置 AI 属性「Ai」→「AI」（schema v3） | `19699349` |
