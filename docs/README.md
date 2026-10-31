# 文档索引（docs/README.md）

> 2026-10-31 建立。目的：让协作者/agent 快速判断"哪份文档是现状、哪份是历史"。
> 状态口径：✅ 现状 · 🕓 历史记录 · 📋 规划/分析 · ⚖️ 法务待复核
> 每份文档请在自身顶部或本表标注「最后核实」日期；改动生产行为时同步更新对应文档。

## 1. 交付与架构（✅ 现状）

| 文档 | 内容 | 最后核实 |
|---|---|---|
| `AGENTS.md`（根） | 完整架构/模块清单/部署与测试约定，改动前先读 | 2026-10-31 |
| `CLAUDE.md`（根） | AGENTS 的精简版，两者同步维护 | 2026-10-31 |
| `docs/CLOUDBASE_MIGRATION.md` | CloudBase 迁移与操作手册（"切解析前"为历史方案） | 2026-10-31 |
| `docs/ARCHIVED_CLI.md` | CLI 归档说明与找回方式 | 2026-10-31 |
| `docs/QUOTA_ENFORCEMENT.md` | 额度强制执行现状与剩余建议 | 2026-10-31 |
| `docs/PRICING.md` | 定价与额度口径（价格/权益真源是 `plans` 表） | 2026-10-31 |
| `docs/BILLING_OPS.md` | 计费运维（套餐/订单/退款/迁移操作） | 2026-10-31 |
| `docs/TECH_DEBT.md` | **技术债唯一账本**（含已修/未修/决策） | 2026-10-31 |

## 2. 功能与上线手册（✅ 现状）

| 文档 | 内容 |
|---|---|
| `docs/PAYMENT_INTEGRATION.md` | 支付集成现状与 API |
| `docs/WXPAY_ROLLOUT.md` / `docs/ALIPAY_ROLLOUT.md` | 微信/支付宝上线手册 |
| `docs/VIDEO_DEEP_EXTRACT.md` | 视频深度解析契约与部署 |
| `docs/VIDEO_GO_LIVE_CHECKLIST.md` | 视频能力上线状态 |
| `docs/BRAND.md` | 品牌与主题规范（改配色前必读） |
| `docs/ICP_FILING_PREP.md` | 备案底稿（已通过，取证保留） |

## 3. 法律文档（⚖️ 已上线，待法务复核）

| 文档 | 说明 |
|---|---|
| `docs/legal/privacy-policy.md` | 隐私政策（构建期渲染为 `/legal/privacy-policy.html`，唯一真源） |
| `docs/legal/terms-of-service.md` | 用户服务协议 |
| `docs/legal/refund-policy.md` | 退款政策 |
| `docs/legal/PENDING.md` | 上线前待办与合规缺口清单 |
| `docs/legal/CHANGELOG-2026-10-31.md` | 2026-10-31 修订对照（供律师复核） |

> 改法律文本**只改 md**；内部「发布前检查」段会被渲染器自动剥离，不会外泄。

## 4. 历史/归档（🕓 仅供追溯）

- `supabase/README.md` — Supabase 时代的历史归档说明（不要在 `supabase/` 加功能）
- `docs/legal/PENDING.md` 中已关闭条目保留处理记录
- 已移除代码的找回方式见对应归档文档（如 `docs/ARCHIVED_CLI.md`）

## 5. 维护约定

1. 生产行为变化 → 同步更新 `AGENTS.md`/`CLAUDE.md` 与对应专题文档。
2. 修/关技术债 → 更新 `docs/TECH_DEBT.md` 对应行（写清日期与验证方式）。
3. 新增额度/权益 → 先在服务端加执行点，再写 `plans.features` 与购买页（否则是虚假承诺）。
4. 新增文档 → 在本索引登记，并标注状态与最后核实日期。
