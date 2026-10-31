# 计费与合规运维手册（Billing Ops）

> 配套文档：`BILLING_DESIGN.md`（设计）、`SHARE_PASSWORD.md`（分享密码）、`legal/`（法律文本）
> **当前状态（2026-10-31 核实）**：计费已部署上线——迁移已应用、`pay` 云函数与 `/pay` 网关路由已上线（微信 Native 可收款；支付宝代码就绪、密钥未配置）、`redeem`/`account` 已在 11 个 HTTP 函数之列；线上 `mimo-chat` 的 `BILLING_MODE=enforce`（仅强制 `ai.tokens.monthly`），**不再是影子计量**。本文 §7「回滚到 shadow」仍有效，但不要按旧文把 enforce 当成"暂勿开启"。

---

## 1. 组成一览

| 组件 | 位置 | 作用 |
|---|---|---|
| 迁移 A | `cloudbase/migrations/20261025000002_billing_core.sql` | plans / entitlements / orders / usage_ledger + resolve_entitlement / reserve_quota / settle_quota / record_usage |
| 迁移 B | `cloudbase/migrations/20261025000003_data_retention_cleanup.sql` | cleanup_expired_data / purge_user_data / list_user_image_paths |
| 迁移 C | `cloudbase/migrations/20261025000001_share_password.sql` | share_password_hash + get_share_secret / set_share_password |
| 云函数 | `cloudbase/functions/mimo-chat/` | 已是按 uid 限流 + **影子计量** |
| 云函数 | `cloudbase/functions/account/` | 账号注销（删数据 + 删图片） |
| 云函数 | `cloudbase/functions/maintenance/` | 定时清理错误日志（可清回收站） |
| 云函数 | `cloudbase/functions/share-admin/` | 设置/清除分享访问密码 |
| 云函数 | `cloudbase/functions/share-ssr/` | 访问密码门（已改造） |

## 2. 部署顺序（重要：迁移必须先于云函数）

```bash
# ① 迁移（按文件名顺序执行；每条都是幂等的）
# ⚠️ `tcb db execute` 只有 --sql、没有 --file（CLI 3.8.7 实测），多行 SQL 用仓库脚本传参：
node scripts/apply-cloudbase-migration.mjs cloudbase/migrations/20261025000001_share_password.sql
node scripts/apply-cloudbase-migration.mjs cloudbase/migrations/20261025000002_billing_core.sql
node scripts/apply-cloudbase-migration.mjs cloudbase/migrations/20261025000003_data_retention_cleanup.sql
# 后续迁移同理按文件名顺序执行（redeem / payment_flow / free_tier_hooks / linkcheck_scan_limit /
# video_deep_quota / deep_quota_refund / ai_quota_expiry…）；单文件 >10KB 时需先分批。

# ② 派生资产（share-render / share-lock / cb-auth）
node scripts/build-fn-assets.mjs

# ③ 云函数
node scripts/deploy-cloudbase-fn.mjs mimo-chat
node scripts/deploy-cloudbase-fn.mjs share-ssr
node scripts/deploy-cloudbase-fn.mjs share-admin
node scripts/deploy-cloudbase-fn.mjs account
```

`maintenance` 是**事件型**函数（定时触发器），不走上面的 HTTP 脚本（它没有 `--httpFn` 路由）：

```bash
# ① 写临时 cloudbaserc.json（含环境变量），随函数一起提交
cd cloudbase/functions/maintenance
cat > cloudbaserc.json <<'EOF'
{"envId":"ulink-d1g5srvjo54b1886a","functions":[{"name":"maintenance","timeout":60,
"runtime":"Nodejs20.19","installDependency":true,
"envVariables":{"CLOUDBASE_ENV_ID":"ulink-d1g5srvjo54b1886a","CLOUDBASE_APIKEY":"<APIKEY>",
"ERROR_LOG_KEEP_DAYS":"365","TRASH_KEEP_DAYS":"0"}}]}
EOF

# ② 部署（--dir . 必给：tcb 默认在 cwd 下找 functions/<name>，找不到会报
#    "Directory for function [maintenance] not found"）
printf '\n' | MSYS_NO_PATHCONV=1 bash <tcb> fn deploy maintenance --dir . --runtime Nodejs20.19 --force --yes

# ③ 注入/更新环境变量（会交互询问 Override / Merge，管道里喂回车选默认 Override）
printf '\n' | MSYS_NO_PATHCONV=1 bash <tcb> config update fn maintenance

# ④ 建定时触发器（cron 是 **7 位**：秒 分 时 日 月 周；UTC 03:00 = 北京 11:00）
printf '\n' | MSYS_NO_PATHCONV=1 bash <tcb> fn trigger create maintenance \
  -e ulink-d1g5srvjo54b1886a --trigger-name daily-cleanup --cron "0 0 3 * * * *"

# ⑤ 删掉含密钥的临时文件，绝不落仓库
rm -f cloudbaserc.json
```

> 校验：`bash <tcb> fn detail maintenance -e <envId>` 的 `Triggers` 行应显示
> `daily-cleanup：{"cron":"0 0 3 * * * *"}`。
> ⚠️ Windows Git Bash 下 `tcb` 需 `MSYS_NO_PATHCONV=1`，否则参数里的路径/表达式会被改写。

## 3. 环境变量

| 变量 | 函数 | 默认 | 说明 |
|---|---|---|---|
| `SHARE_LOCK_SECRET` | share-ssr | 无 | 票据签名密钥（≥32 字节随机）。**缺失时带密码的分享直接 503** |
| `SHARE_SSR_IP_HASH_SALT` | share-ssr | `ulink-share-ssr` | 密码尝试限流 IP 盐 |
| `SHARE_ADMIN_IP_HASH_SALT` | share-admin | `ulink-share-admin` | 同上 |
| `IP_HASH_SALT` | account | 无 | 预留 |
| `ALLOWED_ORIGINS` | share-admin / account | 无 | **必须**含站点源，否则 CORS 拒绝 |
| `BILLING_MODE` | mimo-chat | `shadow` | `shadow`=只记录；`enforce`=按额度拦截（**暂勿开启**） |
| `ERROR_LOG_KEEP_DAYS` | maintenance | `365` | 错误日志保留天数（对应「最长 12 个月」承诺） |
| `TRASH_KEEP_DAYS` | maintenance | `0` | 回收站自动清理；0=关闭（与政策「不设自动过期」一致） |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 4. 影子计量 → 正式收费

### 阶段 1：影子计量（当前，1~2 周）

- `BILLING_MODE=shadow`：只往 `usage_ledger` 写 `ai.requests` / `ai.chars`，**不拦截任何请求**
- 用户体验完全不变；目标是拿到真实用量分布

### 阶段 2：额度怎么定（多数情况下**不需要**等数据）

#### 先看真实成本

MiMo-V2.6-Flash 国内价（元 / 百万 tokens）：

| | 缓存命中 | 未命中 | 输出 |
|---|---|---|---|
| 输入 | 0.02 | 1.00 | — |
| 输出 | — | — | 2.00 |

按常见拆分（输入 80%、输出 20%）测算单用户月成本：

| 额度 | 满额成本 | 备注 |
|---|---|---|
| 20,000 token/月（当前 free） | **¥0.02** | 基本等于免费 |
| 200,000 token/月（当前 plus） | **¥0.24** | 单用户月成本不到 3 毛 |
| 2,000,000 token/月 | ¥2.4 | 重度用户 |

#### 结论：token 成本低到不需要用统计数据校准

关键认知：**额度是上限，不是承诺的消耗**。用户没用满，你一分钱不花。

- 额度调高 → 成本**不会**涨（除非有人用满），只是"撞墙"变少
- 额度调低 → 成本也**不会**涨（封顶了），只是更容易让人撞墙
- 真正的成本风险只有一个：**少数人用满上限**

所以额度应按「我能承受的 × 预期薅羊毛人数」倒推，而不是按"典型用户用量"。当前 free 的 20,000 token 完全够用（成本 ¥0.02），**不必等任何数据**。

#### 那什么时候才真的需要校准数据？

当收费点选错的时候。成本结构如下：

| 收费点 | 有无真实成本 | 是否需要数据校准 |
|---|---|---|
| AI token 额度 | 几乎没有（¥0.02~0.24/月） | ❌ 不需要 |
| 对象存储 | 有（5GB ≈ ¥0.5/月） | ❌ 成本可预测 |
| 死链检测 `linkcheck` | 有（每次外呼） | ✅ 需要（频次差异极大） |
| 视频/网页解析 `video.extract` | 有（每次外呼） | ✅ 需要 |
| 视频深度解析 `video.deep`（ASR + OCR） | 有（下载音视频 + 语音识别/OCR 算力，比轻量解析高 2~3 个数量级） | ✅ 必须独立计量、独立额度；**2026-10-31 起定位为实验性实验室功能（需浏览器扩展，B站正式/抖音小红书实验性），不进入主套餐卖点** |

**这才是关键**：收费点要放在**有真实外部成本**的项上。把「AI token 额度」当卖点会出现「收 ¥12 却只花了 ¥0.24」的观感问题——用户会觉得自己被宰了。

当前套餐设计已经符合这个逻辑：`free` 含少量 `linkcheck`（3 次/日）与 `video.extract`（1 次/日）作为转化钩子，`plus` 为 50 次/天、10 次/天；`video.deep` 只给登录/付费用户（PRO 2 次/日，free 0），且**仅作为实验性体验额度**（需扩展、不保证平台覆盖），不作为主套餐固定承诺。**保持这个结构**，且深度解析必须独立额度——它单次成本远高于轻量解析。

#### 将来真要用数据校准时，注意小样本的偏差来源

1. 早期用户是「最主动的一批」→ P95 偏高，这是**保守方向**（安全）
2. 你自己是作者兼重度用户（会为了测试用满所有功能）→ **你的 P95 ≈ 未来重度用户的 P95**，是有价值的样本，不是噪声
3. 真正需要担心的不是「用户少」，而是「用户结构还没稳定」（来的都是技术圈尝鲜者）

所以启动期的正确做法：**先用成本倒推设一个宽裕值，等有 20+ 真实用户、且发现分布跨度过大时再调**。调额度只需：

```sql
UPDATE public.plans SET features = features || '{"linkcheck.daily": 30}'::jsonb WHERE id = 'plus_monthly';
```

无需改代码、无需发版。

> 补充：当前影子计量记的是 `ai.chars`（字符数），token 是估算值（中文约 1~1.5 字符/token，英文约 4 字符/token，混合保守取 2）。若将来需要精确 token，可在请求里加 `stream_options: { include_usage: true }` 并从 SSE 尾部解析 `usage` —— 但由于成本本就极低，暂不值得动核心流式转发逻辑。

### 阶段 3：开启额度拦截（enforce）

1. 先把 `reserve_quota` / `settle_quota` 在 mimo-chat 中接上（当前只接了 `record_usage`）；
2. `BILLING_MODE=enforce` 灰度放量；
3. 观察 `quota_exceeded` 计数与用户反馈，再全量。

> ⚠️ **enforce 之前必须先做完**：AI 请求改成 `reserve → 调用 → settle` 两段式（客户端断连也要 settle），
> 否则用户「发起后立刻断开」即可白嫖 token。详见 `BILLING_DESIGN.md` §4。

## 5. 支付接入（尚未做，待资质）

个体户营业执照已具备，可开微信支付/支付宝商户号。接入时：

1. `orders` 表已就绪，`channel` 允许 `wechat`/`alipay`；
2. 回调必须验签，且用 `idempotency_key` 唯一约束防重复发货（渠道会重发，微信最多 8 次）；
3. 回调成功后写 `entitlements`（`plan_id` / `expires_at` / `source='order'`），**不要**依赖「取消订阅」回调来降级——按 `expires_at` 算，过期即失效；
4. 金额一律整数分，`amount_cents`。

## 6. 日常运维

### 每日

```sql
-- 昨日用量与活跃
SELECT metric, count(*), sum(amount)
FROM public.usage_ledger
WHERE created_at >= now() - interval '1 day'
GROUP BY metric;

-- 未结算的预留（客户端断连导致的悬挂）
SELECT count(*) FROM public.usage_ledger
WHERE kind = 'reserve' AND created_at < now() - interval '10 minutes';
```

### 每周

```sql
-- 权益即将到期（提前 3 天提醒）
SELECT user_id, plan_id, expires_at FROM public.entitlements
WHERE expires_at IS NOT NULL AND expires_at BETWEEN now() AND now() + interval '3 days';

-- 异常用量（疑似刷量）
SELECT user_id, sum(amount) AS chars FROM public.usage_ledger
WHERE metric = 'ai.chars' AND created_at > now() - interval '1 day'
GROUP BY user_id HAVING sum(amount) > 500000 ORDER BY chars DESC;
```

### 手工补删（客服场景）

```sql
-- 人工开通一个月（补偿场景）
INSERT INTO public.entitlements (user_id, plan_id, status, source, expires_at)
VALUES ('<uid>', 'plus_monthly', 'active', 'manual', now() + interval '30 days')
ON CONFLICT (user_id) DO UPDATE
  SET plan_id = EXCLUDED.plan_id, expires_at = EXCLUDED.expires_at,
      status = 'active', source = 'manual', updated_at = now();

-- 人工清数据（用户邮件要求但应用内注销失败时）
-- 走 account 云函数或：SELECT public.purge_user_data('<uid>');
```

## 6.5 退款操作（人工退款 + 系统自动降级）

2026-10-31 起：渠道退款仍由人工在商户后台操作，退款成功后调用数据库函数留痕，系统自动降级（**不实现渠道退款 API**，见 `docs/PAYMENT_INTEGRATION.md` §7 决策）。

```sql
-- 1) 在微信/支付宝商户后台完成退款
-- 2) 留痕（cents 为本次退款金额；累计退款不得超过订单金额）
SELECT public.mark_order_refunded('<order_id>', <cents>, '{"operator":"手工退款"}'::jsonb);

-- 3) 全额退款会自动：orders.status='refunded'，用户 entitlements.status='refunded'、
--    expires_at=now()（resolve_entitlement / ai_quota_check 因此回落 free 额度）
-- 4) 误退需恢复权益：按上一节「人工开通一个月」处理，并在备注里写明原因
```

注意：多笔订单叠加时，全额退其中一笔会终止当前权益（简化语义）；若需按订单精确扣减，需先补 entitlement ↔ order 关联。

## 7. 回滚

| 情形 | 操作 |
|---|---|
| 计费误拦截 | `BILLING_MODE=shadow` → 重新部署 mimo-chat（即时恢复） |
| 影子计量异常 | 停 mimo-chat 计量分支（`DELETE FROM usage_ledger WHERE period = ...`） |
| 权益误发 | `DELETE FROM public.entitlements WHERE user_id = ...` |
| 分享密码故障 | `UPDATE public.sibling_groups SET share_password_hash = NULL WHERE share_password_hash IS NOT NULL;` + 回滚 share-ssr |
| 迁移回滚 | 四张表与函数互不依赖，可直接 `DROP TABLE` / `DROP FUNCTION`；`share_password_hash` 列为独立新增，`DROP COLUMN` 不影响其它数据 |

## 8. 监控要点

| 指标 | 阈值 | 处置 |
|---|---|---|
| `record_usage` 失败率 | > 1% | 检查 usage_ledger 权限与 `record_usage` RPC 是否存在 |
| `consume_rate_limit` 失败 | 持续 | 该 RPC 异常会导致 AI 整体不可用（fail-closed），优先排查 |
| `get_share_secret` 失败 | 持续 | 分享页会返回 503（不降级放行） |
| 悬挂 reserve 数量 | > 100 | 客户端断连未 settle，需补结算逻辑 |
| 定时清理未执行 | > 25 小时 | 检查 maintenance 触发器状态（承诺日志 ≤12 个月） |
