# ulink 收费业务逻辑设计（Billing Design）

> 状态：**已实施并上线（2026-10-31 复核）**——迁移已应用、pay/`/pay` 已上线、`BILLING_MODE=enforce` 已生效；本文 §3/§8 的「待部署/影子计量/备案审核期」是 2026-10-25 的历史表述。
> 本文档是设计依据与决策记录；**实际部署与运维步骤见 `BILLING_OPS.md`**，分享密码见 `SHARE_PASSWORD.md`。

## 实施状态一览

| 能力 | 状态 | 位置 |
|---|---|---|
| plans / entitlements / orders / usage_ledger | ✅ 已建（迁移待执行） | `migrations/20261025000002_billing_core.sql` |
| resolve_entitlement / reserve_quota / settle_quota | ✅ 已实现 | 同上 |
| record_usage（影子计量） | ✅ 已实现并接入 mimo-chat | 同上 + `mimo-chat/index.js` |
| 按 uid 限流（替代纯 IP） | ✅ 已实现（token 缺失时回退 IP） | `mimo-chat/index.js` + `mimoStream.ts` |
| 账号注销与数据删除 | ✅ 已实现（应用内自助） | `functions/account/` + `migrations/…000003` |
| 错误日志定时清理 | ✅ 已实现（待配触发器） | `functions/maintenance/` |
| AI 服务商告知页 | ✅ 已实现 | `src/config/aiProviders.ts` + 设置面板 |
| 分享访问密码 | ✅ 已实现 | 见 `SHARE_PASSWORD.md` |
| 支付渠道接入 | ⏳ 未做（需商户号，见 `BILLING_OPS.md` §5） | — |
| 额度拦截（enforce 模式） | ⏳ 未做（须先影子计量 1~2 周） | — |
> 前置结论：**收费逻辑 ≠ 支付接入**。先把"服务端可验证的权益真相"建起来，支付渠道可以晚于它上线（先兑换码、后在线支付）。

---

## 0. 一句话架构

客户端只表达意图，**服务端四道闸（验身份 → 查权益 → 扣配额 → 调上游）是唯一门禁**；权益只能由验签后的支付回调写入；用量记入 append-only 账本。

## 1. 现状审计（已核对代码）

| 能力 | 现状 | 缺口 |
|---|---|---|
| 用户身份（云函数侧） | 7 个云函数全部只做 IP 哈希限流，如 `mimo-chat/index.js:113` → `p_key: 'mimo-chat:ip:'+ipHash` | HTTP 触发拿不到 uid。**换 IP 即绕过，且无法按人计量** |
| 用量计量 | `consume_rate_limit`（034/037）窗口计数，过期即删 | 不可累计、不可对账、不可出账单 |
| 权益/套餐 | 39 个迁移中 `quota|plan|tier|subscri` 零命中 | 从零开始 |
| 成本结构 | AI（MiMo 按 token）/ 对象存储（按 GB）/ share-ssr（5min 缓存，按请求） | 三种口径，不能用单一"次数"统一计费 |

结论：**Phase 0 是云函数 uid 化，它既是收费地基，也是当前最大的安全洞修复。**

## 2. 数据模型

```sql
-- 套餐定义：运营可改价改额度，代码只认 feature key
CREATE TABLE public.plans (
  id            TEXT PRIMARY KEY,          -- 'free' | 'pro_monthly' | 'pro_yearly'
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'CNY',
  period_days   INTEGER,                   -- NULL = 永久（free）
  features      JSONB NOT NULL,            -- {"ai.tokens":200000, "share.public_max":20, ...}
  active        BOOLEAN NOT NULL DEFAULT true
);

-- 用户当前权益：一个 user 至多一行
CREATE TABLE public.entitlements (
  user_id           TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES public.plans(id),
  status            TEXT NOT NULL DEFAULT 'active',  -- active|grace|expired|refunded
  feature_overrides JSONB NOT NULL DEFAULT '{}',     -- 兑换码/人工补偿叠加，不污染 plans
  source            TEXT NOT NULL,                   -- order|redeem|manual|trial
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,                     -- NULL = 不过期
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 支付订单：幂等
CREATE TABLE public.orders (
  id               TEXT PRIMARY KEY,       -- 显式 randomUUID，CloudBase .insert() 不回填
  user_id          TEXT NOT NULL,
  plan_id          TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,       -- 整数分，禁 float
  currency         TEXT NOT NULL,
  channel          TEXT NOT NULL,          -- wechat|alipay|stripe|paddle|redeem
  channel_order_id TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending|paid|failed|refunded
  idempotency_key  TEXT NOT NULL UNIQUE,   -- 渠道会重发回调（微信最多 8 次）
  paid_at          TIMESTAMPTZ,
  raw_callback     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用量账本：append-only，只增不改（结算用冲正行，不 UPDATE）
CREATE TABLE public.usage_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  metric     TEXT NOT NULL,        -- ai.tokens | storage.bytes | linkcheck.calls | video.extract
  amount     NUMERIC NOT NULL,     -- 正=消耗，负=结算冲正
  ref        TEXT,                 -- 请求 id，settle 时定位
  period     TEXT NOT NULL,        -- '2026-10'，按 Asia/Shanghai 分桶
  kind       TEXT NOT NULL DEFAULT 'reserve',  -- reserve|settle|refund
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_user_period ON public.usage_ledger (user_id, metric, period);

ALTER TABLE public.plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger  ENABLE ROW LEVEL SECURITY;
-- 四表全部：用户仅可 SELECT 自己；INSERT/UPDATE 一律 service_role（回调与 RPC 内部）
```

> `entitlements` 刻意不复用 `user_security`：那张表是主密码金丝雀，语义是"安全"不是"商业"，混在一起会让安全边界变脏。

## 3. 权益解析（唯一读入口）

```sql
CREATE OR REPLACE FUNCTION public.resolve_entitlement(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e entitlements%ROWTYPE; v_f jsonb;
BEGIN
  SELECT * INTO v_e FROM entitlements WHERE user_id = p_uid;
  IF NOT FOUND THEN
    SELECT features INTO v_f FROM plans WHERE id = 'free';
    RETURN jsonb_build_object('plan_id','free','status','active','features',coalesce(v_f,'{}'::jsonb));
  END IF;
  SELECT f.features || coalesce(v_e.feature_overrides,'{}'::jsonb) INTO v_f
    FROM plans f WHERE f.id = v_e.plan_id;

  -- 过期判断只看服务端 now() + expires_at，不依赖"取消"回调（回调会丢）
  RETURN jsonb_build_object(
    'plan_id',    v_e.plan_id,
    'status',     CASE WHEN v_e.expires_at IS NOT NULL AND v_e.expires_at < now()
                       THEN 'expired' ELSE v_e.status END,
    'expires_at', v_e.expires_at,
    'features',   coalesce(v_f,'{}'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.resolve_entitlement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_entitlement(text) TO authenticated, service_role;
```

**为什么有效期是算出来的而不是查状态字段**：渠道的续费失败/退款通知可能丢失，任何"依赖收到回调才降级"的设计都会白送权益。时间到了就到期，这是唯一不会错的判据。

## 4. 原子扣费：reserve → settle

AI 是流式输出，**事前不知道真实 token 数**。所以必须两段式：

1. 请求前按 `maxTokens` 预扣（`reserve`），超额直接拒绝，fail-closed
2. 流结束后按上游返回的 `usage.total_tokens` 补冲正行（`settle`）

```
用户请求 ──→ reserve(uid, 'ai.tokens', maxTokens) ──→ 上游 ──→ settle(ref, actualTokens)
                 ↑ 不足则 402/429                    ↑ 客户端断连也必须 settle
```

```sql
CREATE OR REPLACE FUNCTION public.reserve_quota(
  p_uid text, p_metric text, p_amount numeric, p_period text, p_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_feat jsonb; v_limit numeric; v_used numeric;
BEGIN
  -- 关键：同 (uid,metric,period) 串行化，否则并发请求双花
  PERFORM pg_advisory_xact_lock(hashtext(p_uid||':'||p_metric||':'||p_period));

  v_feat  := resolve_entitlement(p_uid) -> 'features';
  v_limit := coalesce((v_feat ->> p_metric)::numeric, 0);

  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'metric', p_metric);
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_used
    FROM usage_ledger WHERE user_id=p_uid AND metric=p_metric AND period=p_period;

  IF v_used + p_amount > v_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason','quota_exceeded',
                              'used', v_used, 'limit', v_limit);
  END IF;

  INSERT INTO usage_ledger(user_id,metric,amount,ref,period,kind)
  VALUES (p_uid, p_metric, p_amount, p_ref, p_period, 'reserve');

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_amount, 'limit', v_limit);
END $$;
```

```sql
-- settle：只追加冲正行，绝不 UPDATE（账本必须可审计）
CREATE OR REPLACE FUNCTION public.settle_quota(
  p_ref text, p_actual numeric, p_period text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row usage_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM usage_ledger WHERE ref=p_ref AND kind='reserve';
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO usage_ledger(user_id,metric,amount,ref,period,kind)
  VALUES (v_row.user_id, v_row.metric, p_actual - v_row.amount, p_ref, p_period, 'settle');
END $$;
```

**返回值的坑（本仓已踩过）**：CloudBase 侧 `consume_rate_limit` 拒绝时 `data={}` 而非 `false`。所以新 RPC 一律返回 jsonb 并判定 `data.ok !== true`，**不要写 `if (!data)`**。

## 5. 云函数改造（Phase 0，最大工作量）

1. `src/lib/ai/*`（`mimoStream.ts` / `cloudAiClient.ts`）所有请求带 `Authorization: Bearer <accessToken>`
2. 云函数侧验 token 换 uid —— **已验证可行，见 §5.1**
3. 限流键 `mimo-chat:ip:<hash>` → `mimo-chat:uid:<uid>`；**IP 键降级为二级防风控**（防单账号共享、防脚本），不删
4. 未登录请求：AI 直接 401（不收匿名 token，避免被当免费代理刷）
5. 匿名能力（`check-link` / `extract-video` / `jina-proxy`）：保持 IP 限流 + 更严的日配额

### 5.1 令牌校验：实测结论（2026-10-24）

**根因确认**：HTTP 访问服务触发的云函数没有调用上下文，`@cloudbase/node-sdk` 的 `getUserInfo()` 拿不到用户身份 —— 这就是 7 个函数一律只做 IP 限流、`user_id` 只能落 NULL 的原因。

**绕开方式**：CloudBase 网关提供标准 OIDC 端点，自行验签即可，不依赖 SDK 上下文。

| 探测项 | 实测结果 |
|---|---|
| `/.well-known/openid-configuration` | 200，签发方 `https://<env>.api.tcloudbasegateway.com` |
| `jwks_uri` | `/auth/v1/certs`，返回 **2 把 2048-bit RSA 公钥**（`alg=RS256`, `use=sig`），可被 `node:crypto` 直接导入 |
| `userinfo_endpoint` | `/auth/v1/user/me` |
| 签名算法 | `id_token_signing_alg_values_supported: ["RS256"]` |
| 验签链路真实性 | 用真实 `kid` + 乱签名请求 → `JWT signature verification failed: square/go-jose`（错误由 `key not found` 变为验签失败，证明 kid 匹配 + 公钥有效） |
| 匿名登录 | 生产环境已禁用（`LOGIN_TYPE_DISABLED`），符合预期 |
| **正向用例（已通过）** | 真实登录令牌：`alg=RS256`、`kid` 命中、`sub=2113158489193844736`；本地验签 `{"ok":true,"mode":"offline"}`；userinfo 交叉印证返回同一 uid |

**实测令牌载荷**（access_token 有效期 2h，`iat`/`exp` 相差 7200s）：

```json
{
  "sub": "2113158489193844736",
  "aud": "ulink-d1g5srvjo54b1886a",
  "iss": "https://ulink-d1g5srvjo54b1886a.api.tcloudbasegateway.com",
  "role": "authenticated",
  "email": "...", "name": "...",
  "user_metadata": { "avatar_url": "🐱", "full_name": "herr" },
  "app_metadata": { "provider_type": "username" },
  "project_id": "ulink-d1g5srvjo54b1886a",
  "user_type": "external", "client_type": "client_user",
  "is_system_admin": false,
  "scope": "sso user"
}
```

由此得到三个结论：

1. **令牌自带 `email` / `name` / `user_metadata`** → 云函数取用户资料不必额外查库，一次验签就够（历史上「重登后昵称头像退回默认」正是读取侧字段名不匹配导致，验签后直接用 claims 可绕开）。
2. `role: "authenticated"` 与 Supabase 语义一致；`is_system_admin` 可直接用于管理端判断，无需再查表。
3. ⚠️ **`sub` 是 19 位 bigint 字符串**，`2113158489193844736` 已超出 `Number.MAX_SAFE_INTEGER`（≈9.0e15）→ **全链路必须按字符串处理**。任何 `Number(uid)`、`parseInt`、或塞进 JSON 后参与数值运算，都会精度丢失、把不同用户折叠成同一个。这与既有「`auth.uid()` 返回 TEXT → owner 列 TEXT」的约束同源；收费后 uid 是权益主键，错一位等于把两个用户的账单合并。


**实现**（已落地）：
- 真源 `supabase/functions/_shared/cb-auth.ts` —— 零第三方依赖，可被 vitest 直测
- 派生 `cloudbase/functions/<fn>/cb-auth.js`（`node scripts/build-fn-assets.mjs`，已加入映射表）
- 探针 `node scripts/probe-cb-auth.mjs <token>` —— 一条命令给出令牌形态与两条路径的结论
- 单测 `src/__tests__/cb-auth.test.ts` —— **34 项**，覆盖签名篡改、过期/时钟容差、`alg=none`、HS256 混淆、kid 轮换、opaque token 兜底

**双模式（不猜令牌格式，只认结果）**：

| 模式 | 触发条件 | 开销 |
|---|---|---|
| `offline` | access_token 是可验签的 RS256 JWT | 零外网调用（JWKS 进程内缓存 1h） |
| `userinfo` | opaque token / kid 未命中(强刷后) | 每次一次网关调用，实测 ~50ms |

两者任一成功即放行；都失败 fail-closed 返回 401。`sub` 即 `auth.uid()` 的返回值（TEXT）。

> 实现细节：`verifyJwtWithJwks` 只接受 `RS256`，挡住 `alg=none` 与「把公钥当 HMAC 密钥」的算法混淆攻击；`exp` 容差 60s；无 `kid` 时仅在公钥集唯一时才采用；`sub` 空白串视为未登录。


## 6. 功能分级建议

**绝不能收费的（收了就掉口碑）**
- E2E 加密（主密码/PBKDF2）、数据导出、已存数据的读取、回收站恢复
- 理由：安全与数据主权一旦成为付费项，等于把用户数据当人质

**适合收费的（有增量成本，或"给别人看"的场景）**

| 功能 | 计量口径 | 依据 |
|---|---|---|
| AI 助手 | `ai.tokens` 月度额度 | 唯一直接成本项 |
| 公开分享 | 分享数量 / 自定义 slug / 访问统计 / 去品牌 | 对外展示场景，付费意愿最高 |
| 图片存储 | `storage.bytes` 总量 | 对象存储按 GB 计费 |
| 死链检测 | 日/月调用次数 | 每次一次外呼 |
| 视频提取 | 次数 | 外呼 + 带宽 |
| 版本历史 | 保留天数 | 存储 |

### 6.1 `plans.features` 字段规范（把合规约束钉进 schema）

**命名**：`域.指标.周期`，扁平 key，值一律为数字。`resolve_entitlement` 里 `v_feat->>p_metric` 可直接取值。

**缺省语义**：key 不存在或值 ≤ 0 = 该能力不开放（`reserve_quota` 内 `v_limit <= 0` 直接拒绝，fail-closed）。

```json
{
  "ai.tokens.monthly":    200000,
  "ai.requests.daily":    100,
  "storage.bytes":        5368709120,
  "sync.devices":         3,
  "history.days":         90,
  "linkcheck.daily":      50,
  "video.extract.daily":  10
}
```

**允许的域（白名单）**：`ai` / `storage` / `sync` / `history` / `linkcheck` / `video`

**禁止的域**：`share` / `publish` / `exposure` / `seo`

理由见 §8.5：一旦 `features` 出现分享类限制，产品就变成「付费购买对公众发布信息的能力」，整套「自营工具」抗辩当场崩塌。**用数据库约束把它焊死**，避免以后有人顺手加一个 `share.max`：

```sql
ALTER TABLE public.plans
  ADD CONSTRAINT plans_features_no_share
  CHECK (features::text !~* '"(share|publish|exposure|seo)[^"]*"\s*:');
```

> 用 JSON 文本正则而非 `?|` 操作符：`?|` 只匹配顶层 key，而本方案 key 形如 `share.max`，顶层就是整串 `share.max`，`?| array['share']` 匹配不到。

**三档种子数据**（价格为占位，须等 §9 Phase 1 影子计量拿到 P50/P95 后校准）：

```sql
INSERT INTO public.plans (id, name, price_cents, currency, period_days, features) VALUES
('free', '免费版', 0, 'CNY', NULL,
 '{"ai.tokens.monthly":20000,"storage.bytes":52428800,"sync.devices":1,"history.days":30}'),
('plus_monthly', 'Plus 月付', 1200, 'CNY', 30,
 '{"ai.tokens.monthly":200000,"ai.requests.daily":100,"storage.bytes":5368709120,"sync.devices":3,"history.days":90}'),
('plus_yearly', 'Plus 年付', 10800, 'CNY', 365,
 '{"ai.tokens.monthly":200000,"ai.requests.daily":100,"storage.bytes":5368709120,"sync.devices":3,"history.days":90}');
```

成本参考：MiMo flash 级单价下 20 万 token ≈ ¥0.3/月，对象存储 5GB ≈ ¥0.5/月，单用户变动成本约 ¥1/月量级——毛利足够覆盖收款手续费，但要等真实用量分布再调额度。

## 7. 降级状态机

```
active ──(到期/退款)──→ grace(7d) ──→ expired
                                          │
                          仅限制"增量写入"，永不限制"存量读取"
```

超额时的行为定义：

| 场景 | 行为 |
|---|---|
| AI 额度用尽 | 429 + `ai.quotaExceeded`（含重置日期），不静默失败 |
| 分享数超限 | 已分享的**继续可访问**，仅禁止新增 |
| 存储超限 | 禁止新上传，**不删任何已有图片** |
| 订阅过期 | 全部回到 free 配额；数据一条不动 |

**铁律：降级不得导致任何用户数据丢失或不可访问。** 这是产品能不能活下来的底线。

## 8. 合规：行政许可前置（比支付渠道更硬）

**现行法规**：《互联网信息服务管理办法》已于 **2024-12-06 修订（国务院令第 797 号），2025-01-20 施行**，第三/四条口径未变：

> 经营性互联网信息服务，是指通过互联网向上网用户**有偿**提供信息或者网页制作等服务活动。
> 国家对经营性互联网信息服务实行**许可**制度；对非经营性互联网信息服务实行**备案**制度。

判断标准只有一条：**是否向上网用户有偿提供服务**。与收款渠道、金额大小、是否走第三方支付无关。

### 8.1 流传的「三个无需办证情形」与 ulink 逐条对照

（该三条例外来自代办机构转述的监管口径，非法规明文，但方向与执法实践一致）

| 情形 | 内容 | ulink 是否适用 |
|---|---|---|
| 自营电商 | 自营销售商品/服务，无第三方入驻 | 见 §8.5，取决于收费点设计 |
| 仅发布自身信息 | 只展示自身信息，不为第三方提供发布平台 | 部分不适用：ulink 有用户公开分享页（但该页非收费点） |
| 仅依托小程序/公众号 | 无独立站点或 APP | ✗ ulink 是独立站点 + PWA |
| 平台交易撮合 | 收佣金/服务费 | ✗ 命中（若未来做付费分享市场） |

> ⚠️ 本节早期版本曾断言「不存在覆盖 ulink 的豁免情形、必须办证」，该结论**过于绝对**，已由 §8.5 修正为「灰色地带」。

结论：**不存在覆盖 ulink 的豁免情形**。收费即属经营性，须办 ICP 许可证。

### 8.2 个人主体的死结

ICP 许可证申请主体必须是**依法设立的公司**（内资），个人与个体工商户均不可申请。实务门槛：

| 项 | 要求 |
|---|---|
| 注册资本 | ≥ 100 万（认缴制，不必实缴现金） |
| 人员 | 3 名以上员工社保（各省要求不一） |
| 场地 | 真实办公场地或租赁合同 |
| 审批 | 省通信管理局，法定 60 日 |

真实成本：3 人社保约 4~5 万/年，加场地与代账，**一年 5~10 万量级**——这是尚未验证付费意愿前的实际门槛。

### 8.3 支付渠道不改变定性（更正早期建议）

⚠️ 本文件早期版本建议「Paddle / Lemon Squeezy 过渡、兑换码人工开通」，**该建议在合规上不成立**：只要面向境内用户有偿提供服务，换什么渠道都不改变「经营性」定性，也不免除许可义务。海外 MoR 只解决「能不能收到钱」，没解决「能不能收费」。

唯一安全的过渡形态是**完全不产生对价**：

- ✅ 免费内测、免费发码（`orders.channel='redeem'` 且 `amount_cents=0`）
- ✅ 无对价捐赠（捐赠后不解锁任何特权）
- ❌ 「赞助解锁 Pro」「捐款送会员」—— 有对价即经营性

### 8.4 务实的取舍

| 阶段 | 动作 |
|---|---|
| 现在（备案审核期） | 技术全做但不启用；站点已停解析，零风险 |
| 备案下来 | 免费运营，攒用户与真实用量分布（正好喂给 Phase 1 影子计量） |
| 确认要商业化 | 注册公司 → 变更/重新备案 → 申请 ICP 许可证 → 再接支付 |
| 短期验证付费意愿 | 只做**意向登记**（不收款）或线下访谈 |

### 8.5 「自营软件/工具」抗辩路径（对 8.1 的修正）

若收费点与「公开发布信息」彻底解耦，存在一条比「普遍豁免」扎实得多的主张。

**主张**：ulink 售卖的是自研工具的在线使用权（AI 调用、存储、跨端同步），并非「为第三方提供信息发布或交易撮合的平台服务」，因此不落入 B25 的典型子类。

**四条支撑事实**（须产品与对外文案同时成立，缺一条就破）：

1. 无社区广场、无公开信息流；内容默认私有，登录同步是私有数据跨端流转
2. 无第三方商家入驻、不抽成、不撮合交易 → 与淘宝/闲鱼这类平台有本质区别
3. AI 检索由用户主动触发、结果属该用户私有会话，不建立公共索引库 → 不属 B25-2「信息搜索查询服务」
4. 分享页虽在公网，但**不是收费点**，且无公开信息流、无推荐位、无撮合

**三个薄弱点（不能装作不存在）**

1. **B25 总定义不含「平台」二字**：「通过互联网向上网用户提供信息的服务」覆盖面宽于「平台」，且法规没有任何豁免清单。这是整个抗辩最脆弱处。
2. **分享页仍是匿名可访问的公网页面**。一旦哪天改成「付费解锁更多分享 / 自定义域名分享」，即刻变成「付费获取对公众发布信息的能力」，抗辩当场崩塌。
3. **措辞风险**：SaaS 订阅是「在线服务」，对外称「软件授权」名实不符，被核查时反而成为疑点。

**收费点设计是唯一真正可控的变量**

| 维度 | 低风险 | 高风险 |
|---|---|---|
| 收费点 | AI 调用次数、存储容量、同步设备数 | 分享数量、自定义域名、曝光/推荐位 |
| 分享功能 | 全用户免费、无差别 | 付费解锁 |
| 页面文案 | 用量、容量 | 会员、VIP、特权、专属曝光 |
| 对外表述 | 在线服务订阅 | 软件授权（易被质疑名实不符） |

**结论**：准确表述是——该模式处于**灰色地带**，抗辩有说服力但**非法定豁免**。风险高低主要由收费点设计决定，其次是属地口径与是否被举报。

**另一个更硬的现实约束**：支付通道。微信支付/支付宝商户号需要营业执照（个体户即可），这与 ICP 许可证是两条独立的线。所以即便 ICP 这条抗辩成立，个人主体依然收不到钱。

**本项目当前状态**：已有**个体工商户营业执照**，且备案以个体户名义完成（主体一致，这点是对的）。由此：

| 事项 | 状态 |
|---|---|
| 收款通道 | ✅ 个体户可开微信支付/支付宝商户号，可对外开票 |
| 备案主体一致性 | ✅ 备案主体 = 实际经营者，无「个人备案做公司业务」的瑕疵 |
| ICP 许可证 | ❌ 个体户不能申请（要求公司主体）→ 只能走本节抗辩路径 |
| 税务 | 小规模纳税人按当期起征点政策申报（额度随政策调整，需核实当期口径） |

**关键区分**：个体户解决的是「**能不能收到钱**」，不解决「**要不要许可证**」。两条独立的线，不能互相替代。

**路径**：个体户（已具备）→ 开微信支付商户号 → 按低风险收费点小规模运营 → 出现举报或规模上来，再升公司办证。

个体户办不了 ICP 许可证（要求公司主体），所以这条路是「**低风险**」而非「合规」——两者不能混为一谈。

> 建议在动支付代码前，先向当地省通信管理局咨询窗口确认口径——SaaS 订阅是否被认定为「信息服务」，各地实操存在差异。本文档不构成法律意见。

## 9. 分期落地

| 阶段 | 内容 | 交付判据 |
|---|---|---|
| **Phase 0** | 云函数 uid 化 + `usage_ledger` 落库 | 能在库里按 uid 看到 AI 真实 token 消耗 |
| **Phase 1** | `plans`/`entitlements` + `resolve_entitlement` + **影子计量** | 只记录、不拦截，跑 2 周 |
| **Phase 2** | 兑换码开通 + 降级状态机 + 前端配额展示 | 手动开一个 Pro 账号生效 |
| **Phase 3** | 在线支付 + 回调验签 + 每日对账 | 支付→权益端到端通过 |

**Phase 1 的"影子计量"是必须的**：免费额度不能拍脑袋定。先跑两周拿到真实用量分布（P50/P95），再反推额度。拍太松亏钱，拍太紧赶走用户，而这个数只能测出来。

## 10. 已知坑

- **并发双花**：没有 `pg_advisory_xact_lock` 的 reserve 一定是错的
- **回调幂等**：微信重发最多 8 次；`idempotency_key` 必须唯一约束兜底
- **settle 不能漏**：客户端断连也要结算，否则用户可以"发起后立刻断开"白嫖 token
- **period 分桶时区**：用 `Asia/Shanghai` 生成 `'2026-10'`，否则月初对账差一天
- **share-ssr 的 5min 缓存**：匿名渲染页有 mem-cache（300s）。若付费点含"去水印"，降级后最多延迟 5 分钟生效——需接受，或按 uid 切 cache key
- **`.insert()` 不回填**：CloudBase rdb 行为，`orders.id` 必须 `crypto.randomUUID()` 显式生成
- **金额精度**：全链路整数分，任何 `float` 乘除都是 bug 源
- **客户端时钟不可信**：所有过期判断只用服务端 `now()`
- **uid 是 bigint 字符串**（19 位，超出 JS 安全整数）：权益/账本主键全链路按 string 传递，禁止 `Number()`/`parseInt`/数值比较
- **令牌有效期仅 2h**：云函数不做长缓存；前端需在 401 时静默刷新后重试一次，否则用户会在使用中途被莫名踢回
