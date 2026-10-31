# 支付宝上线推进手册（Alipay Rollout）

> 配套：`PAYMENT_INTEGRATION.md`（链路与接口契约）、`BILLING_OPS.md`（部署运维）、`PRICING.md`（定价）
> 定位：**代码已就绪，只差支付宝侧账号 / 密钥 / 验收**。本手册只讲"怎么把已有代码跑起来"。
> **状态（2026-10-31 复核）**：`pay` 云函数与 `/pay` 网关路由已于 2026-10-28 上线（微信 Native 可收款）；微信 `WXPAY_*` 已配置，**支付宝侧仍未配置**（`.env.local` 无 `ALIPAY_*`）。§1 的 10-28 实测表已按现状更新。

---

## 1. 现状盘点（2026-10-28 实测）

| 层 | 状态 | 证据 |
|---|---|---|
| 数据层 | ✅ 已就绪 | `20261028000010_payment_flow.sql` 已应用，`create_payment_order / attach_pay_payload / settle_paid_order / fail_payment_order / mark_order_refunded` 五个函数均在库 |
| 套餐 | ✅ 已就绪 | `plans`：`free`(¥0) / `plus_monthly`(¥12, 30d) / `plus_yearly`(¥108, 365d)；另有 `pro_quarterly`(¥32, 90d) 在落地页/前端/测试中使用（迁移未 seed，库中是否存在需人工确认） |
| 支付宝渠道代码 | ✅ 已就绪 | `cloudbase/functions/pay/lib/alipay.js`：`alipay.trade.precreate` + RSA2 签名/验签 + `alipay.trade.query` 兜底 + 回调解析 |
| 云函数 `pay` | ✅ **已部署** | 2026-10-28 创建；`tcb fn list` 现含 `pay`（实测状态 `UpdateFailed`，需复核部署产物，见 `TECH_DEBT.md`） |
| 网关 `/pay` 路由 | ✅ 已建 | `tcb routes list`：`/pay` → WEB_SCF（Domain `*`，2026-10-28 创建）；`GET https://ulink.ren/pay?action=plans` 返回 405（服务可达） |
| 渠道密钥 | 微信 ✅ / 支付宝 ❌ | `.env.local` 已有 `WXPAY_*` 全套；**无 `ALIPAY_*`**，支付宝账号/应用/当面付签约仍未开始（脚本映射 10-28 已补） |
| 前端购买页 | ✅ 代码在 | `src/composables/domain/usePayment.ts`（create / checkStatus / 轮询）+ `src/components/modals/PurchaseModal.vue` + `qrcode` 依赖已装 |
| 单测 | ✅ 17 项 | `npx vitest run src/__tests__/pay-libs.test.ts` |

**一句话**：微信侧已上线可收款；支付宝侧只差「支付宝账号 + 应用密钥 + 一笔真实小额验收」。备案已于 10-27 通过（原文「备案通过前只能走当面付」的前提已结束，可同时申请网站支付）。

---

## 2. 路线选择：为什么先走「当面付」

现有代码实现的是 **当面付 `alipay.trade.precreate`**（服务端下单 → 返回 `qr_code` → 前端渲染二维码 → 用户用支付宝扫）。这条路现在就能走，原因：

| 对比项 | 当面付（扫码，本仓库已实现） | 电脑/手机网站支付（跳转收银台） |
|---|---|---|
| **ICP 备案** | **不要求** | **要求**，且备案主体须与支付宝账号主体一致；个体工商户**不接受 ICP 授权函** |
| 与现有代码 | ✅ 直接可用 | ❌ 需新增 `alipay.trade.page.pay` / `wap.pay` 分支 |
| 支付体验 | 页内弹二维码，支付宝扫 | 跳转支付宝收银台完成 |
| 官方定位 | 线下面对面收银（场景错配风险见 §11） | 线上网站收银（与业务完全一致） |

**结论**：备案通过前**只能走当面付**，且它与代码同构；备案通过后再把网站支付作为第二通道叠加上去（前端按渠道分流，见 §10）。

> ⚠️ 支付宝「当面付」官方文档明确：**不再支持小程序场景**（小程序要用 JSAPI 支付）。ulink 是网页，不受影响；但若日后做支付宝小程序，必须换产品。

---

## 3. Step 1 — 支付宝账号与资质（今天可做）

### 3.1 注册企业支付宝账号

- 入口：`https://b.alipay.com` → 注册，主体类型选**企业/个体工商户**，用营业执照 + 经营者身份证实名。
- 建议用**企业支付宝账号**（个体户执照）而非个人账号：个人账号虽能签约，但会被判「非同名执照」而**额度受限**。
- 同步在**支付宝开放平台** `https://open.alipay.com` 注册**企业开发者**（同一份执照），个体户可用。

### 3.2 经营场所照片（当面付唯一的硬材料）

当面付要求：**经营场所照片（招牌照 + 内景照）**、店铺名称、实际经营地址。

官方「门头要求」里有一条对个体户最有用：

> **室内**：招牌 + 经营场所实景（招牌名称完整可辨认 + 营业场所内景，如办公地、经营设备）

个体户可行做法：

1. 用 A4 打印一张**「与链 ulink · 武汉市武汉开发区（汉南区）赫尔网络工作室」**标识，贴/立在工位背景前，拍一张**实景照**（要能看到桌面、设备等经营环境，不是网图）；
2. 再拍一张工位/设备全景；
3. 店铺名称填**与链 ulink**；实际经营地址填**执照上的注册地址**。

**风险与备选**：支付宝当面付是"线下场所"产品，纯线上业务用它存在**场景错配**，审核或后续巡检可能问询。两条退路：

- 若审核不通过 → 申请**当面付基础版**（无需同名执照，但单笔 ≤ ¥2000、单日 ≤ ¥20000；ulink 会员 ¥12/月、¥108/年，远低于限额，**完全够用**）；
- 若连基础版也不通过 → 只能等备案通过走网站支付（§10）。

---

## 4. Step 2 — 商家平台签约「当面付」

1. `https://b.alipay.com` → **产品大全** → 收单工具 → **当面付** → 立即开通；
2. **经营类目**：`网络通讯` → **`其他在线应用或综合类服务`**（官方适用商家："提供其他在线应用或综合类服务的公司申请"，无附加特殊资质）；
   - 同大类里的「软件开发服务」是给建站/域名服务商用的，别选；
   - 「互联网数据服务」要《电信业务经营许可证》，个体户办不了；
   - 费率：**网络通讯整档 0.6%**（1% 只针对游戏/交易平台/网络直播等特殊行业）。
3. 提交材料：营业执照 + 经营场所照片 + 名称/地址；
4. 审核 1–3 个工作日。

**两条硬规则**：

- **类目提交后不能随意改**（变更要重审 1–3 天），且巡检时经营内容与类目不符会**直接关闭收款权限**；
- 材料不合格会被限额（单笔 ≤ ¥2000 / 单日 ≤ ¥20000），额度不足会在流量上来时才暴露 → **上线首日务必用真实小额走通**。

结算规则：默认入支付宝余额实时到账，但**新签约未满 90 日或连续交易未满 30 日**的资金次日结算（`对账中心 > 不可用余额`）。

---

## 5. Step 3 — 开放平台：应用与密钥

1. `https://open.alipay.com` → 开发者中心 → **创建应用** → 类型选「**网页/移动应用**」→ 名称「与链 ulink」→ 上传 logo → **上线应用**；
2. 应用 → 开发设置 → **接口加签方式：公钥**（RSA2 / SHA256withRSA）：
   - 用官方工具生成 **PKCS8 应用私钥**（存好，只有这一次完整展示）与**应用公钥**；
   - 上传应用公钥 → 平台生成 **支付宝公钥**（**这个才是验签用的公钥**，不是应用公钥）；
3. 产出三件套：

| 用途 | 值 | 环境变量 |
|---|---|---|
| 应用 ID | 开放平台 APP_ID | `ALIPAY_APP_ID` |
| 应用私钥 | PKCS8 PEM | `ALIPAY_PRIVATE_KEY` |
| 支付宝公钥 | 平台生成 | `ALIPAY_PUBLIC_KEY` |

4. **沙箱**（强烈建议先做，§8）：沙箱有独立的 APP_ID / 密钥 / 买家账号 / 网关
   - 网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`
   - 沙箱账号、APP_ID、密钥在开放平台「沙箱环境」页下载；
   - 沙箱**不能真实扣款**，但能完整验证下单 → 回调 → 发货 → 查单。

---

## 6. Step 4 — 部署与路由

```bash
cd <仓库根>

# ① 部署函数（cwd 必须是仓库根）
node scripts/deploy-cloudbase-fn.mjs pay

# ② 注入/更新环境变量（--env-only 只换环境变量，不重新打包）
node scripts/deploy-cloudbase-fn.mjs pay --env-only
```

**必配环境变量**（缺任一 → `503 channel_not_configured`）：

| 变量 | 值 |
|---|---|
| `ALIPAY_APP_ID` | 开放平台 APP_ID |
| `ALIPAY_PRIVATE_KEY` | 应用私钥 PEM（PKCS8） |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥 PEM |
| `ALIPAY_NOTIFY_URL` | 回调地址，见 §7 |
| `ALIPAY_GATEWAY` | 留空 = 正式环境；沙箱填沙箱网关 |
| `CLOUDBASE_ENV_ID` | `ulink-d1g5srvjo54b1886a` |
| `CLOUDBASE_APIKEY` | 环境 API Key（`eyJ...`，908 字符） |
| `ALLOWED_ORIGINS` | **域名列表**，含 `https://ulink.ren`（填错或留空 → 所有带 Origin 的请求 403） |
| `IP_HASH_SALT` | 限流盐，每个函数独立 |

> 多行 PEM 在环境变量里用**字面量 `\n`** 写（不是真换行），`lib/alipay.js` 的 `pem()` 会自动还原。

**网关路由（`fn deploy` 不会自动建，必须手加）**：

```bash
bash <tcb> routes edit -e ulink-d1g5srvjo54b1886a
# 新增一条：Path=/pay  →  UpstreamResourceName=pay  →  开启 EnablePathTransmission
```

`pay/index.js` 的 `pathname()` 已把 `/pay` 前缀归一化，**带不带前缀都能命中**，所以透传开关漏了也不会 404——但回调地址要按实际网关行为拼。

---

## 7. Step 5 — `notify_url` 的关键决策（备案期怎么办）

**问题**：备案期间 `ulink.ren` 的 A 记录已删、域名不可解析 → 回调打不通 → 订单永远不发货。

**解法**：回调先挂 **CloudBase 系统域名**（公网可访问，不依赖自己的域名解析）：

```
https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com/pay/notify/alipay
```

- 该域名不要求 ICP 备案，支付宝侧也不校验回调域名备案；
- `ALLOWED_ORIGINS` 只管**浏览器来源**，与回调无关，不要把它当白名单用；
- 备案通过、域名恢复解析后，再把 `ALIPAY_NOTIFY_URL` 改成 `https://ulink.ren/pay/notify/alipay`，两边都保留一段时间以便回溯。

**回调可达性自查**（返回 400/503 属正常，说明路由通了；404 是路由没建）：

```bash
curl -i -X POST "https://ulink-d1g5srvjo54b1886a.service.tcloudbase.com/pay/notify/alipay" \
  -H "Content-Type: application/x-www-form-urlencoded" -d "x=1"
```

---

## 8. Step 6 — 沙箱联调（先沙箱，后生产）

1. 沙箱环境拿一套独立 APP_ID / 应用私钥 / 支付宝公钥 → 替换环境变量，并加 `ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do`；
2. 用**沙箱支付宝 App** 扫沙箱二维码（沙箱页面下载）；
3. 逐项核对：

| 检查点 | 期望 |
|---|---|
| `orders.status` | `pending` → `paid` |
| `orders.notified_at` / `paid_at` | 非空 |
| `orders.raw_callback` | 存有渠道回调原文 |
| `entitlements.expires_at` | **只叠加一次** `period_days` |
| 重复投递同一回调 | 返回 `already_settled`，**权益不再叠加** |
| `pay` 启动日志 | `channels — wechat: true \| alipay: true` |

4. 联调通过 → 把环境变量切回正式网关与正式密钥（`--env-only`），再走一遍 §9。

---

## 9. Step 7 — 生产首笔小额验收

**造一个 1 分钱测试档**（验收完删掉）：

```sql
INSERT INTO public.plans (id, name, price_cents, currency, period_days, features, active)
VALUES ('test_1fen', '测试档(1分)', 1, 'CNY', 1, '{"history.days":90}', true);
-- 注意：features 有 CHECK 约束，share/publish/exposure/seo 永远不可作为付费点
```

> `create_payment_order` 只认 `active = true` 的套餐，所以验收期间保持 `active=true`（前端会显示该档），
> 验收完 `DELETE FROM public.plans WHERE id='test_1fen';` 清掉。

**验收清单**：

- [ ] 真实支付 ¥0.01 成功 → `orders.status='paid'`
- [ ] `entitlements.expires_at` 按 `period_days` **只**延长一次
- [ ] 手动重放同一条回调 → 权益**不得**二次叠加
- [ ] 订单超过 `expires_at`（30 分钟）后支付 → 回调被拒、不发货
- [ ] 前端 `PurchaseModal` 真实下单（非 mock）→ 二维码渲染 → 轮询到 `paid`
- [ ] `refund` 流程：`mark_order_refunded` 仅记本地状态，**渠道退款 API 尚未接入**（见 §12）

---

## 10. Step 8 — 备案通过后的第二通道（网站支付）

备案通过 + 域名恢复解析后：

1. `tcb db execute` 无需再动；`ALIPAY_NOTIFY_URL` 切到 `https://ulink.ren/pay/notify/alipay`；
2. 商家平台申请**电脑网站支付 / 手机网站支付**（类目沿用「网络通讯 / 其他在线应用或综合类服务」）：
   - 硬性要求：**网站已完成 ICP 备案且备案主体与支付宝账号主体一致**；个体户**不接受 ICP 授权函**；
   - 资料：网站地址（或未上线时给首页 / 商品服务页 / 支付页三张截图，截图要**含浏览器地址栏**）；
3. 代码侧需新增 `alipay.trade.page.pay`（PC）/ `alipay.trade.wap.pay`（H5）分支，前端按 `channel` 分流；
4. 微信侧同步：JSAPI 支付要求**已认证服务号** AppID（个体户可注册服务号并认证，¥300/年）。

---

## 11. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| 当面付「线下场景」与纯线上业务错配，巡检问询 | 中 | 材料按「室内办公场景」如实拍；类目描述与经营简介统一为「在线应用订阅」；被问询时如实说明线上交付 |
| 材料不足 → 限额（单笔 ¥2000 / 单日 ¥20000） | 中 | 上线前用真实小额走通；不足时申请当面付基础版 |
| 类目与实际经营不符 → 直接关闭收款权限 | 高 | 类目一次选对；经营简介与类目同源 |
| 应用私钥泄露 → 资金被盗刷 | 高 | 私钥只在**云函数环境变量**，绝不进前端 / 仓库 / 日志；泄露立即在开放平台重置 |
| 回调域名不可达 → 收了钱不发货 | 高 | §7 用系统域名；上线前 curl 自查 |
| 支付宝已发货、微信侧未发货（单渠道故障） | 中 | 有 `alipay.trade.query` 主动查单兜底；上线后每日对账（§12 尚未做） |

---

## 12. 尚未实现（上线后按优先级补）

1. **退款 API**：目前只有本地 `mark_order_refunded` 留痕，未真正调 `alipay.trade.refund` / 微信 `/v3/refund/domestic/refunds`。流程建议：后台人工审核 → 调渠道 → 回调确认 → `mark_order_refunded`。
2. **对账**：每日拉渠道账单与 `orders` 比对，差异告警（当前无）。
3. **落地页价目**：`index.html` 目前无任何会员价目（JSON-LD `offers.price` 仍是 `"0"`），微信/支付宝的经营场景审核都要「价格信息」→ **必须补**（免费版 + Plus ¥12/月 + ¥108/年）。
4. **退款政策口径**：`docs/legal/refund-policy.md` 第四章「四、自动续费」承诺了自动续费/取消自动续费，但实现是**一次性订阅、到期不自动扣款**（主体资格所限，见 `BILLING_DESIGN.md`）→ 需改成「续期提醒 + 用户主动续费」。
5. **自动续费**：个体工商户主体在**微信（委托代扣 2025-07-28 起排除个体户）与支付宝（周期扣款要求注册资本 ≥100 万）都无法开通**，当前设计正好规避。

---

## 13. 操作顺序速查

```
① 注册企业支付宝账号 + 开放平台企业开发者
② 拍经营场所照片（室内办公场景）→ 商家平台申请当面付（类目：网络通讯/其他在线应用或综合类服务）
③ 开放平台创建应用 → 上线 → 配置 RSA2 公钥 → 拿 APP_ID + 应用私钥 + 支付宝公钥
④ 拿沙箱三件套 → 配环境变量（含沙箱网关）→ 部署 pay → 建 /pay 路由 → 沙箱跑通
⑤ 切正式密钥 + 正式网关 → notify_url 指向 CloudBase 系统域名 → 部署 → 造 1 分档真实验收
⑥ 前端 PurchaseModal 真实下单验收；落地页补价目
⑦ 备案通过 → 切解析 → notify_url 换 ulink.ren → 加网站支付第二通道
⑧ 上线后：退款 API → 对账 → 退款政策口径修订
```
