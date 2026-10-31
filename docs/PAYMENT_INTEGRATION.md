# 支付接入（微信 Native / 支付宝当面付）

> 状态（2026-10-31 复核）：**前后端已上线**——云函数 `pay` + `/pay` 网关路由（10-28）、前端 `PurchaseModal.vue` + `usePayment`（选套餐 → 二维码 → 轮询 → 到账）；微信 `WXPAY_*` 已配置，支付宝代码就绪、密钥未配置。**退款 API 与对账仍未实现**（退款走人工在商户后台操作，退款后权益降级也由人工执行）。产品不提供自动续费，不存在"取消自动续费"逻辑。
> **上线操作步骤见 `ALIPAY_ROLLOUT.md`**（支付宝账号 / 签约 / 密钥 / 部署 / 沙箱 / 首笔验收）
> 与 `WXPAY_ROLLOUT.md`（微信商户号侧：小程序 AppID 绑定 / API 证书 / APIv3 密钥 / 部署 / 验收）。

## 1. 整体链路

```
① 前端选套餐 → POST /pay  {action:'create', planId, channel}
        ↓  云函数鉴权 + 限流
② create_payment_order()  ← 金额**唯一来源**是 plans.price_cents（客户端价格一律不采信）
        ↓
③ 调渠道下单（微信 native / 支付宝 precreate）→ 拿到二维码字符串
        ↓  attach_pay_payload() 落库
④ 返回 { orderId, qrCode, amountCents, expiresAt } → 前端渲染二维码
        ↓  用户扫码支付
⑤ 渠道回调  POST /pay/notify/{wechat|alipay}
        ↓  验签（fail-closed）→ 解密（微信 AES-GCM）
⑥ settle_paid_order()  ← 幂等发货：`status='pending'` 条件更新 + entitlements 叠加时长
        ↓
⑦ 渠道应答：微信 `{"code":"SUCCESS"}` / 支付宝 `success`（否则会重推）
        ↓
⑧ 前端轮询 POST /pay {action:'status', orderId}（可选 sync:true 主动查渠道兜底）
```

## 2. 数据层

迁移：`cloudbase/migrations/20261028000010_payment_flow.sql`

`orders` 补充字段：`expires_at` / `pay_payload` / `refunded_at` / `refunded_cents` / `notified_at`。

| 函数 | 作用 | 关键约束 |
|---|---|---|
| `create_payment_order(uid, planId, channel, ttl)` | 建待支付单 | 金额只取 `plans.price_cents`；免费套餐拒绝（`plan_not_payable`） |
| `attach_pay_payload(orderId, payload, channelOrderId)` | 存二维码 | 仅 `pending` 可写 |
| `settle_paid_order(orderId, channel, channelOrderId, paidCents, raw)` | **发货** | `FOR UPDATE` 锁行；`status='pending'` 条件更新防双发；金额不符拒绝；过期单拒绝 |
| `fail_payment_order(orderId, reason)` | 置失败 | 仅 `pending` 可改 |
| `mark_order_refunded(orderId, cents, raw)` | 退款留痕 + **全额退款自动降级** | 仅 `paid`；累计退款不得超过订单额；全额退款时把 `entitlements` 置 `refunded` 并 `expires_at=now()`（2026-10-31） |

全部 `SECURITY DEFINER` + 固定 `search_path`，**只 GRANT 给 `service_role`**，anon/authenticated 不可执行。

### 幂等与重复发货

渠道会重发回调（微信最多 8 次，间隔梯度递增）。防线有两层：

1. `settle_paid_order` 里 `UPDATE ... WHERE status='pending'` + `ROW_COUNT` 判断 —— 并发/重复回调只有一次能改成功；
2. 命中重复时返回 `already_settled` / `not_pending`，云函数仍回 `SUCCESS` 让渠道停止重推（**但不重复发货**）。

### 金额只认服务端

- 下单：`create_payment_order` 读 `plans.price_cents`，客户端传的价格被忽略。
- 回调：`p_paid_cents` 只用于**校验**（与订单额不等即拒），绝不写库。

## 3. 云函数部署

### 3.1 应用迁移

```bash
# 先看一眼当前 schema（可选）
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --json \
  --sql "SELECT column_name FROM information_schema.columns WHERE table_name='orders'"

# 应用迁移（SQL 约 12KB，若超过 tcb 单批 10KB 限制需拆两批）
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a \
  --sql "$(cat cloudbase/migrations/20261028000010_payment_flow.sql)"
```

> ⚠️ 该项目已知：`tcb db execute` 单批约 10KB。本迁移约 12KB，
> 若报长度错误，按 `-- 第 N 段` 注释切成两批执行（先 ALTERTABLE + 索引，后函数 + GRANT）。

### 3.2 部署函数

```bash
node scripts/deploy-cloudbase-fn.mjs pay
```

必配环境变量（缺则返回 `channel_not_configured` / `503`）：

| 变量 | 说明 |
|---|---|
| `CLOUDBASE_ENV_ID` | `ulink-d1g5srvjo54b1886a` |
| `CLOUDBASE_APIKEY` | 环境 API Key（`eyJ...`，908 字符） |
| `ALLOWED_ORIGINS` | **必须**是域名列表（`https://ulink.ren`），填错则所有带 Origin 请求 403 |
| `IP_HASH_SALT` | 限流 IP 哈希盐（每个函数独立） |

微信（`WXPAY_*`）：`APPID` `MCHID` `SERIAL_NO` `PRIVATE_KEY`(PEM) `APIV3_KEY`(32字节) `PLATFORM_CERT`(或 `PUBLIC_KEY`) `NOTIFY_URL`

支付宝（`ALIPAY_*`）：`APP_ID` `PRIVATE_KEY`(PEM) `PUBLIC_KEY` `NOTIFY_URL` `GATEWAY`(沙箱可覆盖)

> 多行 PEM 在环境变量里用字面量 `\n` 转义，代码会自动还原。

### 3.3 网关路由（关键，易漏）

`tcb fn deploy` **不会自动建 WEB_SCF 路由**，必须手动加：

```bash
bash <tcb> routes edit -e ulink-d1g5srvjo54b1886a
# 加一条：path=/pay  →  pay 服务，并开启 enablePathTransmission
```

回调地址（填到商户后台）：

```
微信：https://ulink.ren/pay/notify/wechat
支付宝：https://ulink.ren/pay/notify/alipay
```

云函数内用 `pathname()` 归一化，**带不带 `/pay` 前缀都能工作**（网关透传行为差异不会导致 404）。

## 4. 前端 API 契约

### 下单

```http
POST https://ulink.ren/pay
Authorization: Bearer <CloudBase access token>
Content-Type: application/json

{ "action": "create", "planId": "plus_monthly", "channel": "wechat" }   // channel: wechat | alipay
```

```json
{ "ok": true, "orderId": "3f9c2b7e1a4d4c0e9b8a7d6c5f4e3a2b", "planId": "plus_monthly", "planName": "Plus 月付",
  "amountCents": 1200, "currency": "CNY", "channel": "wechat",
  "qrCode": "weixin://wxpay/bizpayurl?pr=xxx", "expiresAt": "2026-10-28T03:30:00+08:00" }
```

错误：`401 unauthorized` / `429 rate_limited`（10 次/10 分钟）/ `503 channel_not_configured`（未开通）/ `400 plan_not_payable`（免费档）/ `400 unknown_action`（action 不在白名单）。

### 查状态（轮询）

```http
POST https://ulink.ren/pay
{ "action": "status", "orderId": "uuid", "sync": true }
```

`sync:true` 会**主动查渠道**（回调延迟时兜底）。返回 `order.status` ∈ `pending|paid|failed|refunded`。
轮询建议 2s 起、指数退避到 10s，`paid` 或超时（对齐 `expiresAt`）即停。

### 查交易记录（设置 → 交易明细）

```http
POST https://ulink.ren/pay
{ "action": "transactions", "limit": 20, "offset": 0 }   // "orders" 为同义 action
```

返回 `{ ok, list[], total }`，只含当前登录用户的订单（服务端按 uid 过滤；未登录 401）。
**2026-10-31 修复**：此前路由白名单只放行 `create/status/plans`，而实现里已有 `transactions/orders` 分支，导致交易明细恒 `400 unknown_action`；现白名单已补齐并重部署，实测返回 `401 unauthorized`（未登录）/ 正常列表（登录）。

## 5. 商户号接入清单

### 微信支付（Native）

1. 申请商户号 → 绑定 AppID（Native 需要**已认证的服务号或小程序** AppID）
2. 下载 API 证书 → 得到 `apiclient_key.pem`（`WXPAY_PRIVATE_KEY`）与证书序列号（`WXPAY_SERIAL_NO`）
3. 设置 APIv3 密钥（32 位，`WXPAY_APIV3_KEY`）
4. 配置回调地址（`WXPAY_NOTIFY_URL`）
5. **平台证书**：调「下载平台证书」接口获取，或改用 2024 后的公钥模式（`WXPAY_PUBLIC_KEY` + `PUBLIC_KEY_ID_` 前缀的 serial）
6. 产品开通：JSAPI/Native 支付（审核通过后可用）

### 支付宝当面付

1. 开放平台创建应用 → 签约「当面付」
2. 上传应用公钥 → 获得**支付宝公钥**（`ALIPAY_PUBLIC_KEY`）
3. 应用私钥（PKCS8，`ALIPAY_PRIVATE_KEY`）
4. 回调地址（`ALIPAY_NOTIFY_URL`）
5. 沙箱联调：`ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do`

## 6. 上线前自检

- [ ] `node scripts/ssl-renew.mjs` 显示证书 > 30 天（支付回调走 HTTPS，过期会失败）
- [ ] 迁移已应用：`SELECT proname FROM pg_proc WHERE proname LIKE '%payment%'`
- [ ] 云函数环境变量齐全（启动日志会打印 `channels — wechat: true | alipay: true`）
- [ ] 网关 `/pay` 路由存在且开启路径透传
- [ ] 回调地址在商户后台可访问（用 curl 打一次，应回 400/503 而非 404）
- [ ] `ALLOWED_ORIGINS` 含 `https://ulink.ren`
- [ ] 用 1 分钱真实支付跑通一次（两个渠道各一次），核对 `orders.status='paid'` 与 `entitlements.expires_at` 正确叠加
- [ ] 手动重放同一条回调（模拟渠道重推）→ 权益**不得**再次叠加

## 7. 未实现（已决策）

- **退款 API 调用（决策：不做，2026-10-31）**：`mark_order_refunded` 只记本地状态并自动降级；真正调渠道退款（微信 `/v3/refund/domestic/refunds`、支付宝 `alipay.trade.refund`）不实现——需要商户退款权限、证书与真实订单联调，误操作风险高。
  当前流程：人工在商户后台退款 → 调 `mark_order_refunded` 留痕并自动降级（见 `docs/BILLING_OPS.md`）。政策见 `docs/legal/refund-policy.md`。
- **对账（决策：保持人工）**：继续用商户后台导出对账；如订单量上升再考虑每日拉账单与 `orders` 比对告警。
- **自动续费**：当前是一次性订阅（到期不自动扣款），符合"不自动续费"的合规取向。

## 8. 测试

```bash
npx vitest run src/__tests__/pay-libs.test.ts
```

17 项，覆盖：分↔元转换（含非法输入、负数、非整数）、支付宝待签名串排序与排除、
微信验签 fail-closed（缺头/时间戳双向偏差/无密钥）、微信 AES-256-GCM 回调解密
（真实构造密文 + 篡改检测 + AAD 不匹配）。
