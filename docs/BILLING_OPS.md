# 计费与合规运维手册（Billing Ops）

> 配套文档：`BILLING_DESIGN.md`（设计）、`SHARE_PASSWORD.md`（分享密码）、`legal/`（法律文本）
> 当前状态：**代码与迁移已就绪，待部署**。生产仍在免费模式，影子计量不拦截任何请求。

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
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --file cloudbase/migrations/20261025000001_share_password.sql
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --file cloudbase/migrations/20261025000002_billing_core.sql
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --file cloudbase/migrations/20261025000003_data_retention_cleanup.sql

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

### 阶段 2：校准免费额度

```sql
-- 近 30 天每日 AI 用量分布（按 Asia/Shanghai 分桶）
SELECT
  period,
  count(DISTINCT user_id)                                   AS users,
  count(*) FILTER (WHERE metric = 'ai.requests')            AS requests,
  round(avg(chars))                                          AS avg_chars,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY chars)        AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY chars)        AS p95,
  max(chars)                                                 AS max_chars
FROM (
  SELECT user_id, period, metric,
         sum(amount) FILTER (WHERE metric = 'ai.chars') AS chars
  FROM public.usage_ledger
  WHERE period >= to_char(now() at time zone 'Asia/Shanghai' - interval '30 days', 'YYYY-MM')
  GROUP BY user_id, period, metric
) t
GROUP BY period
ORDER BY period;
```

**校准原则**：免费额度取 p50 的 2~3 倍（让绝大多数用户不被打扰），付费额度取 p95 的 1.5~2 倍（覆盖重度用户）。
`ai.chars` 与 token 的换算比例需实测校准（中文约 1.5 字符/token，英文约 4 字符/token，混合取 2.5）。

改额度只需 `UPDATE public.plans SET features = ... WHERE id = 'free';`，**无需改代码**。

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
