# 微信支付上线推进手册（WxPay Rollout）

> 配套：`PAYMENT_INTEGRATION.md`（链路与接口契约）、`ALIPAY_ROLLOUT.md`（支付宝侧）、`BILLING_OPS.md`（部署运维）
> 适用前提：**商户号已开通、Native 支付产品已开通、微信小程序已认证**（2026-10-28 状态）。
> 定位：补齐「密钥 → 部署 → 路由 → 验收」这段，让 Native 收款能真正上线。

---

## 0. 现状与缺口（2026-10-28 实测）

| 项 | 状态 | 说明 |
|---|---|---|
| 商户号 / Native 产品 | ✅ 已开通 | 你确认 |
| 小程序认证 | ✅ 已认证 | 可作 Native 下单的 `appid`（需与商户号建立绑定关系，见 §2） |
| 数据库迁移 | ✅ 已应用 | `create_payment_order / attach_pay_payload / settle_paid_order / fail_payment_order / mark_order_refunded` 均在库；`plans` 有 free / plus_monthly ¥12 / plus_yearly ¥108 |
| 渠道代码 | ✅ 已就绪 | `cloudbase/functions/pay/lib/wxpay.js`：Native 下单 / APIv3 签名 / 回调验签+解密 / 主动查单 / 关单 |
| 前端购买页 | ✅ 代码在 | `src/composables/domain/usePayment.ts` + `src/components/modals/PurchaseModal.vue` + `qrcode` 依赖 |
| **`pay` 云函数部署** | ✅ **已部署** | 2026-10-28 创建；`tcb fn list` 已含 `pay`（最近一次更新状态 `UpdateFailed`，需复核，见 `TECH_DEBT.md`） |
| **网关 `/pay` 路由** | ✅ 已建 | `tcb routes list`：`/pay` → WEB_SCF（Domain `*`，10-28 创建）；`GET https://ulink.ren/pay?action=plans` 返回 405（服务可达） |
| **渠道密钥注入** | ✅ 已注入 | `.env.local` 已有 `WXPAY_APPID/MCHID/SERIAL_NO/PRIVATE_KEY/APIV3_KEY/PUBLIC_KEY/NOTIFY_URL`；上线前仍需核对平台证书/公钥模式二选一 |
| ICP 备案 | ✅ 已通过 | 2026-10-27 通过，`鄂ICP备2026061718号-1` 已展示（`src/config/site.ts`）；公安联网备案仍在 30 日期限内，待办 |
| 落地页价目 | ✅ 已上线 | `index.html` 已有四档价目（免费/PRO 月 ¥12/季 ¥32/年 ¥108）；仅 JSON-LD `offers.price` 仍为 `"0"`（待补） |

---

## 1. 关键判断：Native 收款**不用等备案**

微信 Native 支付的下单接口 `POST /v3/pay/transactions/native` **没有 `redirect_url`，也不校验支付域名白名单**——它是"商户自己出二维码、用户扫码"。所以：

- ✅ **不需要 ICP 备案**，不需要先申请"支付域名权限"；
- ✅ 唯一的域名依赖是 **回调地址 `notify_url`**，只要公网 HTTPS 可达即可（见 §6）；
- ⚠️ 商户平台的「支付产品-产品权限申请」页（要 ICP 备案截图 + 经营场景截图）**是给 H5/JSAPI/APP 支付用的**，Native 用不到 → 那一页可以先放着。

结论：**今天就能上线扫码收款**。落地页价目页仍然要做（微信经营场景审核与用户体验都要），但它不挡收款联调。

---

## 2. Step 1 — 把小程序 AppID 绑到商户号（必做）

Native 下单请求体里的 `appid` **必须与商户号存在绑定关系**，否则接口报「APPID 与商户号无绑定关系」。

1. 微信支付商户平台 → **产品中心 → AppID 授权管理** → 新增授权申请单；
2. 填小程序 AppID + 授权说明（写「与链 ulink 官方小程序收款」即可）；
3. 由**小程序管理员微信扫码确认**（这一步必须管理员本人操作）。

---

## 3. Step 2 — API 证书 / APIv3 密钥 / 平台证书

进入 **账户中心 → API 安全**：

| 要拿的东西 | 位置 | 用途 | 存进哪个环境变量 |
|---|---|---|---|
| **商户 API 证书**（`apiclient_key.pem` + `apiclient_cert.pem`） | API 安全 → 申请 API 证书（用官方工具生成 CSR） | 请求签名 | `WXPAY_PRIVATE_KEY`（私钥内容）+ `WXPAY_SERIAL_NO`（证书序列号） |
| **APIv3 密钥** | API 安全 → 设置 APIv3 密钥（**32 位，自己设定**） | 回调解密 | `WXPAY_APIV3_KEY` |
| **平台证书 / 微信支付公钥** | API 安全 → 平台证书（下载 `wechatpay_*.pem`）**或** 微信支付公钥（`PUB_KEY_ID_` 开头） | 回调验签 | `WXPAY_PLATFORM_CERT`（证书模式）**或** `WXPAY_PUBLIC_KEY`（公钥模式） |

要点：

- **APIv3 密钥必须自己记牢**：回调用它解密，遗失只能重置，重置后**重推的历史回调就解不开了**；
- **平台证书有有效期**（约 1 年），过期后回调验签直接失败。两种模式代码都支持
  （`wxpay.js` 依据回调头 `Wechatpay-Serial` 是否以 `PUB_KEY_ID_` 开头自动选择验签密钥），
  **公钥模式长期有效，省心**；但两种模式都需要商户 API 证书（请求签名用的 `WXPAY_SERIAL_NO` 仍是商户证书序列号）；
- 本模块**不自动轮换平台证书**（刻意不引入定时任务依赖），到期前要手动换。

---

## 4. Step 3 — 密钥落到 `.env.local`（本次已打通脚本映射）

`.env.local` 已在 `.gitignore`（第 16 行），私钥不会进仓库。

```
# 微信支付
WXPAY_APPID=wx????????????????
WXPAY_MCHID=1?????????? 
WXPAY_SERIAL_NO=1A2B3C4D...
WXPAY_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----
WXPAY_APIV3_KEY=32位APIv3密钥
WXPAY_PLATFORM_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
# 或（公钥模式，二选一）
WXPAY_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
WXPAY_NOTIFY_URL=https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com/pay/notify/wechat
```

> ⚠️ **多行 PEM 必须写成字面量 `\n`**（不是真换行）——`readEnvLocal()` 是单行正则，真换行会被截成第一行；云函数里的 `pem()` 会把 `\n` 还原成真换行。

> ✅ **本次已补**：`scripts/deploy-cloudbase-fn.mjs` 的 `FN_EXTRA_ENV` 此前**没有 `pay` 条目**，
> 意味着直接部署 pay 只会注入 `CLOUDBASE_ENV_ID` / `CLOUDBASE_APIKEY`，
> 渠道密钥一个都进不去 → 函数恒返回 `503 channel_not_configured`。现已补上 `pay` 映射
> （微信 8 项 + 支付宝 5 项 + `IP_HASH_SALT` + `ALLOWED_ORIGINS`），
> 并在 `FN_PROFILE` 里给 pay 单独设 `timeout: 30`（下单要同步调渠道 API，20s 偏紧）。

---

## 5. Step 4 — 部署与路由

```bash
cd <仓库根>

# ① 部署（含建路由 + 注入环境变量）
node scripts/deploy-cloudbase-fn.mjs pay

# ② 只换环境变量（密钥轮换时用，跳过代码包与路由步骤）
node scripts/deploy-cloudbase-fn.mjs pay --env-only
```

脚本行为（已核对 `scripts/deploy-cloudbase-fn.mjs`）：

- `httpPath` 默认 `/${fnName}` → **`/pay`**；
- 用 `tcb fn deploy pay --force --httpFn --path /pay --runtime Nodejs20.19 --deployMode zip` 部署，
  随后自动执行 `tcb routes edit` 把路由上游类型修正为 **WEB_SCF** 并开启**路径透传**
  （不修会回 `FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid`）；
- `installDependency: true` → 自动装 `@cloudbase/node-sdk`；
- 临时含密的 `cloudbaserc.json` 推送后立即删除。

**校验**：

```bash
bash <tcb> fn list -e ulink-d1g5srvjo54b1886a | grep pay
bash <tcb> routes list --json -e ulink-d1g5srvjo54b1886a | grep -B2 -A8 '"/pay"'
```

期望：函数状态 `Deployment completed`；路由 `Path=/pay` → `UpstreamResourceName=pay` →
`UpstreamResourceType=WEB_SCF` → `EnablePathTransmission=true`。

---

## 6. Step 5 — `notify_url`：备案期用 CloudBase 系统域名

`ulink.ren` 备案期间 A 记录已删、域名不可解析 → 回调打不通 → **收了钱不发货**。

**备案期**（推荐，微信不校验回调域名备案）：

```
https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com/pay/notify/wechat
```

**备案通过后**切回：

```
https://ulink.ren/pay/notify/wechat
```

两段都保留一段时间，便于回溯历史订单。

**自查**（返回 400/503 说明路由通；404 说明路由没建或前缀不对）：

```bash
curl -i -X POST "https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com/pay/notify/wechat" \
  -H "Content-Type: application/json" -d '{}'
```

`pay/index.js` 的 `pathname()` 已把 `/pay` 前缀归一化，**带不带前缀都能命中**。

> 回调验签失败/缺签名头 → fail-closed 直接拒绝（`missing_signature_headers` / `timestamp_skew` / `signature_mismatch`），
> 时间戳偏差超过 **300 秒** 也拒（防重放）。

---

## 7. Step 6 — 首笔小额验收（真实 1 分钱）

**造测试档**（验收完删）：

```sql
INSERT INTO public.plans (id, name, price_cents, currency, period_days, features, active)
VALUES ('test_1fen', '测试档(1分)', 1, 'CNY', 1, '{"history.days":90}', true);
-- features 有 CHECK 约束：share / publish / exposure / seo 永远不可作为付费点
DELETE FROM public.plans WHERE id='test_1fen';   -- 验收后清理
```

**验收清单**：

- [ ] 前端 `PurchaseModal` 真实下单（`POST /pay {action:'create', planId, channel:'wechat'}`）→ 返回 `qrCode`（`weixin://wxpay/bizpayurl?pr=...`）→ 二维码渲染正常
- [ ] 微信扫码付 ¥0.01 成功 → `orders.status='paid'`、`notified_at`/`paid_at` 非空、`raw_callback` 有原文
- [ ] `entitlements.expires_at` **只叠加一次** `period_days`
- [ ] 重放同一条回调 → 权益**不得**二次叠加（返回 `already_settled`）
- [ ] 订单超过 `expires_at`（默认 30 分钟）后再支付 → 拒绝发货
- [ ] 回调丢失场景：把 `notified_at` 清空后 `POST /pay {action:'status', orderId, sync:true}` → 主动查单兜底发货
- [ ] `pay` 启动日志出现 `channels — wechat: true | alipay: false`（渠道配置齐全标记）

---

## 8. Step 7 — 小程序已认证 → 第二通道（JSAPI，可后置）

Native（扫码）能用，但体验是"页内弹二维码"。小程序已认证，可以做**小程序支付**（`wx.requestPayment` 直接唤起，体验更好）：

1. 商户平台申请**「小程序支付」**产品，并绑定该小程序 AppID（§2 的授权申请单可复用）；
2. 小程序后台 → 开发管理 → 服务器域名 → **request 合法域名**加 `https://ulink.ren`
   （或 `https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com`）；
3. 小程序端调 `pay` 网关需要 `Authorization: Bearer <CloudBase access token>` →
   要么接 `@cloudbase/js-sdk` 登录拿 token，要么在网关层做一次身份换取（工程量另计）。

**建议**：先让 Native 跑通把钱收上，小程序通道作为体验优化单独排期，**不要阻塞上线**。

---

## 9. 备案通过后的动作

1. 恢复 `ulink.ren` 解析（备案与 Cloudflare 互斥，过审即切解析）；
2. `WXPAY_NOTIFY_URL` 切回 `https://ulink.ren/pay/notify/wechat`；
3. 提交「支付产品-产品权限申请」（支付域名 + ICP 备案截图 + 经营场景截图）→ 开通 H5/JSAPI 支付；
   - 备案主体须与商户主体一致，个体户一般不接受备案授权函；
   - 经营场景截图要含**浏览器地址栏**，且页面要有**价格与商品名称**；
4. 补落地页价目（免费版 + Plus ¥12/月 + ¥108/年），同步修 `index.html` 的 JSON-LD `offers.price`（现在还是 `"0"`）。

---

## 10. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| 平台证书到期 → 回调验签全失败 | 高 | 记到期日，到期前换；或直接用公钥模式 |
| APIv3 密钥遗失 → 历史回调解不开 | 高 | 存密码管理器；换密钥后旧的 `raw_callback` 无法再重放解密 |
| AppID 未绑定 → Native 下单直接报错 | 高 | §2 先做 |
| 回调不可达 → 收了钱不发权益 | 高 | §6 用系统域名 + curl 自查；代码侧有主动查单兜底 |
| 订单重复发货 | 高 | `settle_paid_order` 用 `status='pending'` 条件更新 + `ROW_COUNT` 判断（已实现） |
| 费率 | — | 0.6%；微信默认 T+1 结算，新商户前 90 天可能次日结算 |
| 密钥泄露 | 高 | 私钥只在 `.env.local` + 云函数环境变量，不进仓库/前端/日志 |

---

## 11. 速查

```
① 商户平台绑定小程序 AppID（管理员扫码）
② 账户中心→API安全：申请 API 证书（存私钥+序列号）、设 APIv3 密钥、下载平台证书或微信支付公钥
③ .env.local 写 WXPAY_*（PEM 用字面 \n）+ notify_url 用 CloudBase 系统域名
④ node scripts/deploy-cloudbase-fn.mjs pay        （部署+建 /pay 路由+注入环境变量）
⑤ fn list / routes list 校验 pay 与 /pay（WEB_SCF + 路径透传）
⑥ 造 1 分档 → 前端真实下单 → 扫码付 → 核对 orders/entitlements → 重放回调验幂等
⑦ 小程序通道（可选）：申请小程序支付 + request 合法域名 + wx.requestPayment
⑧ 备案通过 → 切解析 → notify_url 换回 ulink.ren → 支付域名权限申请 + 落地页价目
```
