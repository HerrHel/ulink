# 额度强制执行现状与建议（Quota Enforcement）

> 2026-10-31 审计结论。`plans.features` 里写了 11 个额度键，但**真正被服务端强制执行的只有 4 个**；
> 其余只是展示/文案，用户理论上可以无限使用。本文逐项给出「现状 / 强制点在哪 / 成本 / 推荐」。

## 一、总览

| 额度键 | 是否强制 | 强制点 | 备注 |
|---|---|---|---|
| `ai.tokens.monthly` | ✅ | `mimo-chat` 调 `ai_quota_check`（`BILLING_MODE=enforce`） | 唯一有月度总量的 AI 门控 |
| `video.extract.daily` | ✅ | `extract-video`（`consume_rate_limit` + `writeJson` 校验） | 轻量解析 |
| `video.deep.daily` | ✅ | `extract-video` deep 提交 / 状态查询（失败退额度） | 2026-10-31 迁移到 `plans.features` 正式生效 |
| `linkcheck.auto` / `linkcheck.auto.max` | ✅ | 死链「自动巡检」开关与单用户上限（客户端 + check-link 约定） | 只有自动巡检受限 |
| `ai.requests.daily` | ❌ | 无 | 只出现在 plans/购买页文案 |
| `linkcheck.daily` | ❌ | 无 | 手动死链检测没有按日计数 |
| `storage.bytes` | ❌ | 无 | 图片/笔记容量没有服务端校验 |
| `sync.devices` | ❌ | 无 | 无设备注册表，无法判定 |
| `history.days` | ❌ | 无（cleanup 按全局 365 天） | 本质是保留期而非配额 |

## 二、逐项分析与推荐

### 1) `ai.requests.daily`（免费 0 / PRO 100）——**建议补，成本低**
- 现状：`mimo-chat` 已有 `usage_ledger`（`metric='ai.chars'` 记字符）与 `ai_quota_check`，但只按 token 包月，不按日请求数。
- 补法：`mimo-chat` 在 `record_usage` 时加一条 `metric='ai.request'` 的日计数（或直接 `consume_rate_limit(key='ai:req:{uid}:{date}', limit=plan值, window=86400)`），enforce 下超额 429。
- 成本：约 20 行、一次云函数部署；不影响既有 token 口径。
- 影响：能挡住「单日高频刷免费/PRO 额度做批量任务」的滥用；对正常用户几乎无感。

### 2) `linkcheck.daily`（免费 3 / PRO 50）——**建议补，成本低**
- 现状：手动死链检测走 `check-link`，只受「每分钟 1200 次」限流，没有日额度。
- 补法：`check-link` 入口处 `consume_rate_limit('linkcheck:{uid}:{date}', plan 值, 86400)`；匿名走 IP/全局额度（已知 IP 可伪造，见 AGENTS 警告）。
- 成本：约 10 行 + 部署；`plans.features` 已有值，不需要迁移。
- 影响：兑现「免费 3 次/日」的公开承诺；对正常用户（一次几十个书签）几乎无感；若担心误伤，可先 `shadow` 观察一周。

### 3) `storage.bytes`（免费 200MB / PRO 5GB）——**建议先改文案，后补实现**
- 现状：笔记图片写入公开存储桶，无容量统计与拦截；`purge_user_data`/`list_user_image_paths` 有按用户列举能力（`20261025000003`）。
- 难点：容量 = 笔记 HTML 内嵌图片 + 上传对象合计；每次写入都要增量统计，跨云函数（`account`/图片上传走前端直传？）容易绕过。
- 推荐：**短期不要把它当"已生效额度"宣传**（购买页/PRICING 已标注）；中期做「图片存储配额」——上传前查 `sum(size)`（`list_user_image_paths` + 对象元数据），超额拒绝并提示清理。笔记文本容量继续按 schema 截断兜底。

### 4) `sync.devices`（免费 2 / PRO 3）——**建议移除承诺，不建议做**
- 现状：同步无设备概念，登录态 token 即可在任何设备使用；要实现必须引入设备注册表 + 设备管理 UI + 踢下线逻辑。
- 成本/风险：产品复杂度高、误踢真实用户风险大；收益仅是"防止账号共享"，而账号共享本身可用其他方式（如登录风控）处理。
- 推荐：**从 plans/购买页移除该键**（或标注"规划中"），不实现。

### 5) `history.days`（免费 90 / PRO 90）——**不是配额，建议按保留期处理**
- 现状：`maintenance` 的 `cleanup_expired_data` 用全局 365 天；`history.days=90` 未被读取。
- 补法：cleanup 按用户 plan 取 `history.days` 删除更早历史（已有清理框架，成本中等）。
- 推荐：把它定位为「历史保留期」而非"额度"：实现按 plan 的 cleanup（P2），文档统一措辞；不阻塞收费。

## 三、总体建议（按优先级）

1. **P1 立即补**：`ai.requests.daily` + `linkcheck.daily`（各 ~10-20 行，收益明确、风险低）。
2. **P1 收口承诺**：`sync.devices` 从展示撤下；`storage.bytes` 标注"仅展示/规划"直到实现图片配额。
3. **P2**：`history.days` 走 cleanup 按 plan 执行；`storage.bytes` 实现图片配额。
4. **原则**：**对用户展示的每一个数字，都要有服务端可拒绝的执行点**；没有执行点的就不展示（比"宣称了但可无限用"更安全，尤其涉及付费权益）。
