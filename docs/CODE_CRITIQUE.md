# LinkVault 代码审查 · 洁癖工程师视角（已核实修订版）

> 立场：有代码洁癖的软件工程师。关注一致性、重复、双重真相源、约定是否被强制、以及"勉强能跑"的妥协。
> **核实记录**：初版批判于 2026-08-17 撰写；同日 19:15 逐条 file:line 复跑 `grep`/`sed`/`read` 复核。复核发现初版中 4 条最"刺眼"的指控在当前工作树中**无法复现**——代码其实已经做了收口（集中常量 / `z.infer` 推导）。这 4 条已撤回。当前 git 工作树为 **dirty** 状态（utils.ts / useBookmark.ts / useDeadLinkChecker.ts / welcome-data.ts / ShareView.vue / constants.ts 等多个文件有未提交修改），以下以当前磁盘文件为准。

---

## ✅ 经核实成立的发现

### P0 · `stores/data.ts` 是 1084 行的"上帝 Store"
- 书签 / 组 / 分类 / 自定义属性的**全部 CRUD + 过滤 + 排序**集中在一个文件（1084 行，复核于 2026-08-17）。
- 仅此一文件就有 **277 行（按行统计）含下划线前缀内部引用**，其中 **28 个 `this._` 实例成员**（另有大量 `const _` / 局部下划线变量）。
- 洁癖点：**靠 `_` 前缀假装私有 ≠ 真私有**。TS 有 `private` / `#` 真私有字段，下划线只是约定，编译器拦不住外部 `store._xxx` 伸进去改。277 处分散在 1086 行 = 内部实现全部暴露成"看起来能调的 API"，且任何改动都波及面最大、风险最高。
- 建议：按子领域反向拆成 `data-bookmarks.ts` / `data-groups.ts` / `data-categories.ts` / `data-attributes.ts` 四个 store，facade 仍走 `app.ts`。拆完 `data.ts` 应消失。
- ⚠️ 初版写的"298 处"是过宽正则计数，核实后修正为 **277 行 / 28 个 `this._` 成员**。

### P1 · 同一条环境判断被逐字复制两份（成立）
- `src/composables/domain/useBiometric.ts:88`
- `src/composables/domain/useVaultBiometric.ts:88`

两行**一字不差**：
```ts
if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false
```
今天改其中一个忘了另一个，行为就分裂。建议抽到 `src/lib/secureContext.ts` 导出 `isBiometricCapableContext(): boolean`，两处调用（零风险去重）。

### P2 · 提交卫生：16% 的历史是机器人噪声（成立）
- 总提交 1071，其中 **173 条 `auto-opt/*`** 自动提交（占 16%）。
- `git log` 本应记录"人做了什么决策"，现在约 1/6 是机器流水，且"活跃度 1071 次"注水明显。
- 建议：auto-opt 走 `--fixup` + autosquash 或单独 bot 分支定期 rebase 进 main，别污染主时间线。

### P3 · 三处"替代 bridge.ts"遗留注释（成立，但仅注释）
- `src/stores/actionSheet.ts:4` / `src/stores/contextMenu.ts:4` / `src/stores/toast.ts:4`
- 代码本身已无 `import bridge`（无死链），但这三句把"已完成的迁移"写成"正在进行"。建议改为描述当前职责，去掉"替代 bridge"时态。

### P3 · welcome-data.ts 重复内联卡片串（成立，轻微）
- `src/config/welcome-data.ts` 里 DeepSeek（b3）/ 抖音（b4）两张卡片 HTML 出现在两个欢迎区块（约 line 41-42 与 118-119），字符串逐字重复。
- 建议：抽 `makeInlineCard(id, domain, name)` 模板函数。

### ✅ 卫生表扬（核实成立）
- 源码 **0 处 `@ts-ignore` / `console.log` / `var` / 空 `catch`** —— 类型约束严格、无调试残留、错误处理无"吞掉就当没发生"。
- `sanitize` 非重复（初版澄清成立）：`sanitizeReportUrl`（errorReporter.ts:30）与 `sanitizeHTML` / `sanitizeReadonlyHTML`（utils.ts:157/162）名字不同、职责不同。

---

## ❌ 已撤回的指控（初版批判有误，当前代码已收口）

| 初版指控 | 核实结果 | 真相 |
|---|---|---|
| **P1 双重真相源 / 半吊子类型策略**（称 Bookmark 等手写 interface 平行镜像 schemas.ts） | **撤回** | `src/types.ts:16-20` 全部为 `export type X = z.infer<typeof XSchema>`，文件头明言"所有数据模型由 Zod schema 推导"。**不存在双重真相源**。AGENTS.md 写的"两者需保持同步"是过时文档，代码本身无此问题。 |
| **P1 favicon 三处两源**（称 utils.ts:68 写死 xinac、useBookmark.ts:577 写死 Google、welcome-data 7 处硬编码绕过 favicon()） | **撤回** | `utils.ts:68` 现已用 `FAVICON_PROVIDER_URL` 常量；`useBookmark.ts:577` 现调 `favicon(safeUrl)`；`welcome-data.ts` 也改用 `FAVICON_PROVIDER_URL`。xinac 已**单源收口**到 `src/config/constants.ts:26`。 |
| **P2 deadlink 写死三 URL**（称 useDeadLinkChecker.ts:140-142 内联 baidu/gstatic/cloudflare） | **撤回"写死"定性** | 实际是 `NETWORK_PROBE_URLS` 常量（`constants.ts:28`），且注释明言"换环境 / 区域可在此统一调整，避免写死失效"。已是集中可配置。 |
| **P2 ShareView.vue:136,184 早年写死 herrhel.github.io**（已整改） | **撤回位置** | 实际是 `APP_CANONICAL_BASE` 常量（`src/config/urls.ts:25`，值 `https://ulink.ren/`），ShareView 仅引用（`ShareView.vue:141/197`）。单源常量、换域名只改一处——属轻微事项，非"散落写死"。 |

> 说明：初版扫描得到上述硬编码内容，但多次独立复跑均得到"已用常量"的结果。无论差异源于工作树在两次扫描间被改动、还是初版读取有偏差，**以当前磁盘文件为准**，这 4 条指控不成立，特此撤回。它们恰好是我初判里说"最脏"的几条——复查表明代码其实已经做了我建议的收口。

---

## 修正后的真实结论

代码比我初判**干净得多**。真正成立的洁癖点只剩 5 个：
1. 上帝 Store `data.ts`（仍最优先）
2. biometric 环境判断逐字复制（零风险去重）
3. auto-opt 提交噪声（历史卫生）
4. bridge 遗留注释（仅注释）
5. welcome-data 小重复（轻微）

其余"硬编码 / 不一致 / 双重真相源"均不成立——甚至我初版给的"收口到常量 / 用 z.infer 推导"等建议，代码**已经做了**。这也提示：**AGENTS.md 的架构描述已落后于代码**（如"types 与 schemas 需保持同步"），应同步修订以免后人（和我一样）误判。

## 基于核实后真实状态的建议
1. **拆 `data.ts`**（P0，1084 行上帝 Store，影响面最大）
2. **抽 `isBiometricCapableContext()`**（P1，一行去重零风险）
3. **修订 AGENTS.md 过时描述**：把"类型定义见 types.ts，Zod 校验见 schemas.ts（两者需保持同步）"改为"types 由 schemas 经 `z.infer` 推导，单一真相源"；并注明 favicon / 探活 / canonical 均已收口到 `config/constants.ts`
4. **auto-opt 提交 squash**（P2）
5. **清 bridge 遗留注释 + welcome-data 去重**（P3，顺手）
