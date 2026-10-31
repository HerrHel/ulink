# 额度强制执行现状（Quota Enforcement）

> 2026-10-31 更新。目标：**对外展示的每个额度都有服务端可拒绝的执行点**；没有执行点的就从展示中撤下。
> 结论：`plans.features` 的 10 个键中，**7 个已有服务端强制点**，1 个降级为展示值（storage.bytes），
> 1 个撤下（sync.devices），`history.days` 已落地为按 plan 的历史保留期清理。

## 一、总览

| 额度键 | 是否强制 | 强制点 | 备注 |
|---|---|---|---|
| `ai.tokens.monthly` | ✅ | `mimo-chat` → `ai_quota_check`（`BILLING_MODE=enforce`） | 月度 token 总量 |
| `ai.requests.daily` | ✅ **2026-10-31 补** | `mimo-chat` → `resolve_entitlement` + `consume_rate_limit('ai:req:{uid}:{date}')` | free 20/日、PRO 100/日（迁移 `20261031000004`） |
| `video.extract.daily` | ✅ | `extract-video`（`consume_rate_limit`） | 轻量解析 |
| `video.deep.daily` | ✅ | `extract-video` deep 提交 / 状态查询（失败退额度） | 2026-10-31 正式生效 |
| `linkcheck.daily` | ✅ **2026-10-31 补** | `check-link` → 可选鉴权（`cb-auth`）+ `resolve_entitlement` + `consume_rate_limit('link-check:uid:{uid}:{date}')` | 只计**手动**检查（`mode=manual`）；自动巡检按 `linkcheck.auto.max` 另行限制 |
| `linkcheck.auto` / `linkcheck.auto.max` | ✅ | 客户端按权益开关自动巡检；单次巡检条数上限 | 与 `linkcheck.daily` 分离，避免巡检打满每日额度 |
| `history.days` | ✅ **2026-10-31 补** | `cleanup_expired_data` 按用户 plan 的 `history.days` 清理 `data_history` | 由 `maintenance` 日跑；无权益用户按 90 天 |
| `storage.bytes` | ⚠️ **展示值** | 无（图片直传对象存储，未做容量统计/拦截） | 购买页标注「展示值，暂未限额」；实现图片配额需改上传链路，见下 |
| `sync.devices` | ❌ **已撤下** | — | 无设备体系，无法执行；2026-10-31 从 `plans.features` 移除 |
| `test_1fen` 测试档 | — | — | 仅测试用，未配置额度 |

## 二、实现说明

### 1) `ai.requests.daily`
- `mimo-chat` 在 token 月度额度检查之后、调用上游之前执行：读 `resolve_entitlement().features`，有该键则 `consume_rate_limit` 按自然日（Asia/Shanghai）计数；超额 429 `quota_exceeded`（`quota: ai.requests.daily`）。
- RPC 失败 **fail-open**（与 token 额度一致，配额系统故障不误伤用户），日志留痕。
- 免费档此前无该键 → 等于免费用户无每日请求上限；迁移已补 20/日。

### 2) `linkcheck.daily`
- `check-link` v1 原本没有用户身份（只按 IP 哈希限流）；本次增加**可选鉴权**：请求带 `Authorization: Bearer <token>` 时用 `cb-auth` 换 uid，按用户 plan 执行每日额度；**匿名请求不要求 token**，仍走 IP 分钟限流（本地/未登录用户不受影响）。
- 前端 `invokeCbFunction` 增加可选 token 参数，死链检测会附带登录 token；`mode=manual|auto` 区分手动与自动巡检。
- 口径：手动检查计 `linkcheck.daily`；自动巡检按 `linkcheck.auto.max`（单次上限）+ 分钟限流，避免一次 500 条巡检打满 PRO 的 50 次/日。
- 已知边界：`mode` 由客户端上报，属于**防误用/成本控制**而非对抗性强制；对抗性滥用仍依赖 IP 分钟限流与后续风控。

### 3) `history.days`
- `cleanup_expired_data` 新增第 ③ 步：按每个用户的 plan 保留期删除 `data_history` 早期版本（`resolve_entitlement → features['history.days']`，缺省 90 天）。
- 无需改 `maintenance` 代码：它已调用该 RPC，下一次定时执行即生效（迁移后已手工调用验证返回 `history_deleted`）。

### 4) `storage.bytes`
- 现状：笔记图片由前端直传对象存储，服务端没有容量统计/拦截；做真实配额需要改上传链路（服务端签发/校验 + 增量统计），成本较高。
- 处理：购买页标注「展示值，暂未限额」，不把它当已生效承诺；后续实现见 `docs/TECH_DEBT.md` 待办。

### 5) `sync.devices`
- 同步没有设备注册表，无法执行；按产品决定撤下，不再展示（迁移同时从 `plans.features` 删除）。

## 三、剩余建议

1. `storage.bytes` 图片配额（P2）：上传前按用户汇总已用容量并拒绝超额；需要改 `imageStorage`/上传云函数。
2. `linkcheck.daily` 的 `mode` 若要做强对抗，需要服务端区分「手动触发」的可靠信号（例如专用接口/一次性令牌），当前仅防误用。
3. 任何新增额度键：先有服务端执行点，再加入 `plans.features` 与购买页，否则视为虚假承诺。
