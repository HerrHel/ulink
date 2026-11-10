# 文档索引（docs/README.md）

> 2026-10-31 建立，**2026-11-10 全量核实更新**。
> 目的：让协作者与任何新接手的 agent 快速判断「哪份文档是现状、哪份是历史」，避免误入歧途。
> 状态口径：✅ 现状（生产正在运行） · 🕓 历史记录（仅供回溯） · 📋 规划/分析 · ⚖️ 法务/合规
> 每份文档请在自身顶部或本表标注「最后核实」日期；改动生产行为时同步更新对应文档。

---

## 1. 交付、架构与运维（✅ 现状）

| 文档 | 内容与核心结论 | 最后核实 |
|---|---|---|
| `AGENTS.md`（根） | **核心指引**：完整架构、13 个 HTTP 云函数 + maintenance、部署与测试约定，改动前必读 | 2026-11-10 |
| `CLAUDE.md`（根） | `AGENTS.md` 的精简版，两者同步维护 | 2026-11-10 |
| `docs/CLOUDBASE_MIGRATION.md` | CloudBase 迁移与操作手册（生产已切 CloudBase，文内"切解析前"属历史方案记录） | 2026-11-10 |
| `docs/AI_BACKEND_SPLIT.md` | AI 能力分布与端点迁入：CF Pages 退役，`/api/*` 迁入 CloudBase 云函数 `ai-api` | 2026-11-10 |
| `docs/QUOTA_ENFORCEMENT.md` | 额度强制执行现状：AI 请求/Token、视频、死链、历史天数已在服务端强制；storage 为展示值 | 2026-11-10 |
| `docs/PRICING.md` | 定价与额度口径（唯一真源是 `plans` 表，PRO 月付 ¥15 / 季付 ¥32 / 年付 ¥108） | 2026-11-10 |
| `docs/BILLING_OPS.md` | 计费运维（套餐/订单/退款/迁移操作；`mimo-chat` 线上已实测 `enforce` 两段式计费） | 2026-11-10 |
| `docs/SHARE_PASSWORD.md` | 分享访问密码实施与运维：最短 6 位，`share-admin` CORS fail-closed，票据 HMAC 绑定 | 2026-11-10 |
| `docs/TECH_DEBT.md` | **技术债唯一账本**：含已修/未修/决策，记录依赖审计与架构演化 | 2026-11-10 |
| `docs/BRAND.md` | **品牌视觉纪律**：四主题四色相是品牌签名，改配色/动效前必读 | 2026-10-31 |
| `docs/sync-e2e-governance.md` | 同步协议治理与分层 E2E（`useCloudSync` 编排、Playwright L0/L1/L2） | 2026-10-31 |

## 2. 支付、媒体与上线手册

| 文档 | 状态 | 内容与当前口径 | 最后核实 |
|---|---|---|---|
| `docs/PAYMENT_INTEGRATION.md` | ✅ 现状 | 支付接入架构与 API（微信 Native 已收款，支付宝电脑/手机网站支付就绪，全额退款自动降级） | 2026-11-10 |
| `docs/WXPAY_ROLLOUT.md` | ✅ 现状 | 微信 Native 支付上线手册（商户号绑定、证书与私钥配置、回调验收） | 2026-11-10 |
| `docs/ALIPAY_ROLLOUT.md` | ✅ 现状 | 支付宝电脑网站支付与手机 WAP 支付手册（自适应收银台） | 2026-11-10 |
| `docs/VIDEO_DEEP_EXTRACT.md` | 🕓 历史契约 | 视频深度解析契约与设计；**2026-11 容器已删除，改走多模态直连** | 2026-11-10 |
| `docs/VIDEO_GO_LIVE_CHECKLIST.md` | 🕓 历史手册 | 视频上线排查清单（仅作历史参考，切勿重新部署 worker 容器） | 2026-11-10 |
| `docs/ICP_FILING_PREP.md` | 🕓 历史取证 | ICP 备案底稿（2026-10-27 通过 `鄂ICP备2026061718号-1`，取证保留） | 2026-10-31 |
| `docs/ICP_BUSINESS_MODEL_STATEMENT.md` | 📋 备用文书 | 业务模式情况说明（非主动提交，监管问询时使用） | 2026-10-31 |

## 3. 合规与公安联网备案（⚖️ 现状）

目录 `docs/compliance/`（内部制度材料，不构建对外 HTML，防隐私电话泄露）：

| 文档 | 内容与用途 | 最后核实 |
|---|---|---|
| `docs/compliance/CHECKLIST.md` | 公安联网备案执行清单（CLS 日志留存 210 天、`audit_log` 处置台账、填报参数） | 2026-11-10 |
| `docs/compliance/site-security-policy.md` | 网站安全管理制度（提交材料一） | 2026-11-03 |
| `docs/compliance/incident-response-plan.md` | 网络安全应急预案（提交材料二） | 2026-11-03 |
| `docs/compliance/security-self-assessment.md` | 安全自评估报告（提交材料三） | 2026-11-03 |
| `docs/compliance/generative-ai-statement.md` | 生成式人工智能情况说明（向主管机关说明合规边界） | 2026-11-03 |

## 4. 法律文档（⚖️ 已上线，构建期渲染为公开网页）

正文修改**只改 md 真源**，Vite 构建期由 `renderLegalDoc.ts` 渲染为 `/legal/<slug>.html`；末尾「发布前检查」段自动剥离：

| 文档 | 说明 |
|---|---|
| `docs/legal/privacy-policy.md` | 隐私政策（唯一真源，已披露境内大模型服务、支付、日志留存） |
| `docs/legal/terms-of-service.md` | 用户服务协议（自营技术服务、无自动续费） |
| `docs/legal/refund-policy.md` | 退款政策（7天退款窗口、全额退款自动降级） |
| `docs/legal/PENDING.md` | 法律合规待办与已关闭历史记录 |
| `docs/legal/CHANGELOG-*.md` | 历次法务修订对照表（2026-10-31 ~ 2026-11-07） |

## 5. 历史归档（🕓 仅供回溯，不要在其上开发）

- `docs/ARCHIVED_CLI.md` — 2026-10-31 移除的 CLI 归档与找回说明
- `docs/BACKEND_AUDIT.md` — 2026-09-02 Supabase 时代后端审查快照（已全量迁 CloudBase，门禁已下线）
- `docs/CODE_CRITIQUE.md` — 2026-08-17 代码审查快照（经核实成立的问题已全部修复收口）
- `docs/BILLING_DESIGN.md` — 2026-10-25 计费早期设计草案（已实施上线，以 `BILLING_OPS.md` 为准）
- `scripts/video-worker/README.md` — `ulink-video-worker` 容器微服务实现与归档说明（已停用）
- `supabase/README.md` — Supabase 时代历史归档说明（双后端兼容层仍保留垫片）

---

## 6. 维护约定

1. **生产行为变化** → 同步更新 `AGENTS.md` / `CLAUDE.md` 与对应专题文档。
2. **修/关技术债** → 更新 `docs/TECH_DEBT.md` 对应行（写清日期与验证方式）。
3. **新增额度/权益** → 先在服务端实现强制执行点，再写 `plans.features` 与购买页（否则是虚假承诺）。
4. **新增文档** → 在本索引登记，并标注状态与最后核实日期。
