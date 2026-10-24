# Supabase → CloudBase 迁移与 ICP 备案方案

> 状态：方案稿（2026-10-22）。基于实机核查，非纸面推演。凡标 ⚠️ 的是已确证会卡住的点。

## 1. 现状核查（已实测）

| 项目 | 结果 | 来源 |
| --- | --- | --- |
| 站点 | 国内站（`tcb.cloud.tencent.com`，region `ap-shanghai`） | `tcb login` 授权页 |
| 登录 | ✅ 已登录（设备码 OAuth，无密钥落盘） | `tcb env list` 正常返回 |
| CLI | `tcb` 3.8.7 | `tcb --version` |
| 环境 | `ulink-d1g5srvjo54b1886a`（别名 ulink） | `tcb env list` |
| 套餐 | **个人版**（`baas_personal`），2026-10-22 10:22 由体验版升级 | `tcb env detail --json` |
| 数据库 | **PostgreSQL 已开通**：实例 `postgres-2m9745ae`，PG 17.11，`TenantType=SHARED` | `Meta: postgresql=enable` + `PostgreSQL[]` 非空 |
| 云存储 | 已启用（`756c-...-1436146693`） | `tcb env detail` |
| 云函数 | 已启用（namespace = envId） | 同上 |
| 静态托管 | 已启用，`ulink-d1g5srvjo54b1886a-1436146693.tcloudbaseapp.com` | 同上 |

> ⚠️ **`tcb env detail` 的人类可读输出会骗人**：它把「数据库」显示为 `[Not enabled]`，但那读的是 legacy NoSQL/FlexDB 字段。判据只能看 `--json` 里的 `Meta: postgresql=enable` 与 `PostgreSQL[]` 是否非空。

**结论：这个环境已经可以作为迁移目标。** 最初创建时是体验版（无数据库），10:22 升到个人版后 **PostgreSQL 随套餐一并开通了**——所以「PG 模式不能就地升级」在本次实测中被推翻：升级套餐会补发 PG 实例。代价是原先计划的「新建 PG 环境」不必要，省掉第二次付费。

沿用的历史约束仍然成立：体验版不能备案（现已是个人版，此条已解除）；剩余有效期需 > 6 个月才能备案（当前 1 个月，**备案前必须续期**）。

## 2. ICP 备案：可行，但有三个硬前提

`.ren` 在可备案后缀清单内：ZDNS（互联网域名系统北京市工程研究中心）自 2020-03-20 起是 `.ren` 顶级域的工信部许可注册管理机构，`ulink.ren` 购自腾讯云，主体一致时可直接走腾讯云备案。

CloudBase 侧的备案准入条件（官方文档，三条同时满足）：

| 条件 | 当前状态 |
| --- | --- |
| 套餐为个人版及以上 | ✅ 已是个人版 |
| 环境剩余有效期 > 6 个月 | ❌ 当前只买了 1 个月，**提备案前必须续到 ≥ 12 个月** |
| 环境已开启「云托管固定 IP」 | ❌ 未开启（个人版套餐本身包含该能力，开一下即可） |

管局审核 1–20 个工作日。一个环境最多备案 2 个网站。

⚠️ **备案与 Cloudflare 互斥**。备案要求域名解析到境内资源且不得经境外 CDN 中转，而当前 `ulink.ren` 是 `CNAME → ulink.pages.dev`（Cloudflare Pages）。备案通过后必须：

1. 在 DNSPod 把 `@`/`www` 的 CNAME 改指 CloudBase 下发的 CDN CNAME；
2. 关闭 Cloudflare 代理；
3. **在此之前**分享 SSR 必须已迁到 CloudBase 云函数——否则 `/s/<gid>` 直接 404，而这是被外部引用的公开链接。

顺序上必须是「迁移完成 → 备案通过 → 切解析」，不能反过来。切解析那一刻是唯一无法平滑回滚的动作，必须选低峰。

## 3. 迁移面盘点（实测量）

| 资产 | 规模 | 迁移方式 |
| --- | --- | --- |
| SQL 迁移文件 | 38 个（001–038） | 大部分可复用，见 §4 差异 |
| PL/pgSQL 函数 | 19 个 | 可复用，`auth.uid()` 引用共 88 处 |
| Edge Functions | 7 个（`check-link` / `extract-video` / `jina-proxy` / `mimo-chat` / `report-error` / `send-feedback` / `share-html`） | Deno → Node 云函数重写 |
| 前端直连 Supabase 的源码 | 17 个（`syncRemotePort` / `syncShare` / `stores/auth` / `imageStorage` / `errorReporter` / AI 三件套等） | 换驱动 |
| 相关单测 | 13 个文件 | 跟着换 mock |
| 实时订阅 | `useSyncRealtime` 单点，基于 `postgres_changes` | ⚠️ 见 §4.3 |
| 分享 SSR | `functions/_lib/share-render.ts`（零依赖纯函数）+ CF Pages Functions | 纯函数可原样搬到 Node 云函数 |

**好消息：CloudBase PG 与 Supabase 是同构的。** 官方文档与技能包明确写着它提供 PostgREST 风格查询、`RLS`、`auth.uid()` / `auth.role()` / `auth.jwt()` 策略助手、`service_role` 语义、以及仿 Supabase Storage 的 `pgstore` bucket 模型。所以这不是「换一套后端重写」，而是**换驱动 + 打类型补丁**。`syncRemotePort` 这层抽象存在，正是当初设计得当的红利。

## 4. 三个已确证的硬骨头

### 4.1 `auth.uid()` 与 `auth.users` —— 已实测，结论明确

在目标环境实测（`tcb db execute` 直查）：

```sql
-- auth schema 只有 4 个函数，全部返回标量
auth.uid()  -> text      -- 实现 = coalesce(current_setting('request.jwt.claim.sub'), claims->>'sub')::text
auth.role() -> text
auth.jwt()  -> jsonb
auth.email() -> text

-- auth schema 有 19 张表，auth.users 存在，但：
auth.users.id  -> bigint          -- 不是 uuid
auth.users.sub -> varchar         -- JWT sub 落在这列
-- auth.users 的约束只有 PRIMARY KEY (id)，sub 没有唯一约束
```

三个连带结论：

1. **`auth.uid()` 返回 text**，所以 owner 列必须是 `TEXT`，不能留 `UUID`——否则 88 处策略全部 `uuid = text` 类型错误。
2. **不能保留 `REFERENCES auth.users(id)` 外键**：那列是 `bigint`，而我们要存的是 `sub` 字符串；且 `sub` 无唯一约束，退而求其次引用 `auth.users(sub)` 也建不起来。10 处外键必须删除，所有权约束改由 RLS 策略 + `DEFAULT auth.uid()` 承担。
3. **`DEFAULT auth.uid()` 可用**，官方推荐写法就是 `owner_id TEXT NOT NULL DEFAULT auth.uid()`——由数据库而非浏览器决定归属，伪造 owner 值会被 INSERT 策略拒掉。这点比现有 Supabase 实现更硬。

已核对的配套能力：

| 能力 | 状态 |
| --- | --- |
| 角色 `anon` / `authenticated` / `service_role` | ✅ 三个都在 → 031 的 GRANT 收权基线可原样重放 |
| `storage.buckets` / `storage.objects` | ✅ 存在 → pgstore bucket 模型可直接复用 |
| `pg_cron` | ✅ 可安装（1.6，未装） |
| `pgcrypto` / `uuid-ossp` | ✅ 可安装 |
| `pgvector` / `pg_net` | ❌ 无（本项目未用，不影响） |

### 4.1b 身份迁移是真问题

旧库里 `user_id` 存的是 Supabase 的 uuid；迁到 CloudBase 后 `auth.uid()` 给的是 CloudBase 新生成的 `sub` 字符串，两者**对不上**。不做映射的话，用户重新登录后看到的是一片空白。

方案：导入时保留旧 uuid（存进 TEXT 列），建 `legacy_identity_map(legacy_uuid, sub, email)`；用户首次在 CloudBase 登录后，凭邮箱验证认领，一次性把各表 `user_id` 从旧 uuid 改写为新 sub。邮箱是唯一稳定的跨平台锚点。

### 4.2 实时订阅

`useSyncRealtime` 用 `channel.on('postgres_changes')`。CloudBase 的实时推送是面向 NoSQL 变更流的，PG 模式下是否等价**未经验证**。若不可用，退路是：`useSyncRealtime` 降级为「可见性/在线时轮询 + 本地合并」，`syncCircuit` 熔断与 `syncMergeCore` 合并逻辑不变——这层本来就有幂等合并，退化为轮询不会破数据一致性，只影响多端实时性。

### 4.3 安全基线要重做，不能照抄

现有 031 的 defense-in-depth 是 Postgres 原生 GRANT 收权（anon 零表权限、authenticated 无 TRUNCATE），这部分**在 CloudBase PG 上语义一致，可整体复用**。但依赖 Supabase 平台侧的假设会失效：

- `pg_cron`（`033_link_check_history_auto_prune`）能否在托管 PG 用，需确认；
- `report-error` 用 `functions.invoke` + IP 计数限流，云函数侧要重写成 CloudBase 调用方式；
- 匿名公开读仍必须走 SECURITY DEFINER RPC 白名单——这条铁律不变，`get_public_group` / `get_public_category` 原样可用。

## 5. 推荐路线（分阶段，每阶段可独立验收）

**P0 — 建目标环境（需付费，卡在这里）**

```bash
tcb env create --alias ulink-pg --package baas_personal --postgresql \
  --region ap-shanghai --duration 12 --auto-renew --yes
```

12 个月而非 6 个月：备案要求剩余有效期 > 6 个月，且审核要 1–20 个工作日，6 个月会踩线。建完开启「云托管固定 IP」，随即有资格提备案。

**P1 — 驱动层**（不依赖云环境，可先做）
抽出 `src/lib/backend/` 适配层：PG 查询、Auth、Storage、Functions 四个端口。CloudBase 侧用 `@cloudbase/js-sdk` v3（`app.rdb()` / `app.storage.from(bucket)` / `auth.getSession()`）。先用 mock 与单测打通，确保 13 个现有测试文件在换 mock 后仍绿。

**P2 — schema 与数据**
按 §4.1 选定策略后重放 38 个迁移（去掉 `auth.users` 外键、调整 `user_id` 类型），跑通 `supabase/tests/assertions.sql` 那 14 项断言（权限不变量那 3 项尤其要保）。数据用脚本按 `user_id` 导 → 灌。

**P3 — 云函数**
7 个 Edge Function 逐个改为 Node 云函数。`share-html` 与 `check-link` 里已抽好的纯渲染/纯判断逻辑直接 import，不重写。

**P4 — 分享 SSR 落 CloudBase**
`functions/_lib/share-render.ts` 是零依赖纯函数，搬进云函数即可；把 `functions/_lib/share-cache.ts` 的 Cache API 换成云函数侧的缓存（或 CDN 缓存规则）。

**P5 — 切换与备案**
双写观察 → 切读 → DNSPod 改解析指向 CloudBase → 提备案 → 备案号下来后挂站点页脚。留意 `ulink.ren` 那一刻的 `/s/*` 链路。

## 6. 回滚

P0–P4 全程不动生产 Supabase。切换前 `ulink.ren` 仍指 Cloudflare Pages，Supabase 仍是权威。真正的不可逆动作只有 P5 的 DNS 改指，此前任何一步出问题都可以原地放弃、零影响。

## 7. 已决策 / 仍待实测

已定（实测定论）：

- [x] **`user_id` 一律 `TEXT`**，删除 10 处 `REFERENCES auth.users(id)` 外键 —— `auth.uid()` 返回 text，且 `auth.users.id` 是 bigint、`sub` 无唯一约束。
- [x] `pg_cron` 可安装；`pgcrypto` / `uuid-ossp` 可安装；无 `pgvector` / `pg_net`。
- [x] 角色 `anon` / `authenticated` / `service_role` 齐备，031 权限基线可重放。
- [x] `storage.buckets` / `storage.objects` 存在，pgstore bucket 可复用。

仍待实测：

- [ ] PG 模式下实时推送能力（决定 `useSyncRealtime` 照搬还是降级轮询）
- [ ] 用户身份映射：旧 Supabase uuid → 新 CloudBase `sub`（见 §4.1b）

已决策：

- [x] 备案主体：**个体工商户**（可含经营性内容；需营业执照 + 经营者身份证）
- [x] 先买 1 个月个人版做迁移验证，验完再续到 ≥ 12 个月提备案

## 8. 迁移工具（本次新增）

| 文件 | 作用 |
| --- | --- |
| `scripts/transform-migrations.mjs` | 把 `supabase/migrations/*.sql` 批量适配为 CloudBase 可执行版本，输出到 `cloudbase/migrations/<14位版本>_<name>.sql` |
| `scripts/apply-cloudbase-migrations.sh` | 逐个应用迁移（一次只放一个进 `cloudbase/migrations/`），首个失败即停并回退文件，便于定位 |

适配规则（脚本内实现，均有实测依据）：

1. `X UUID [NOT NULL|PRIMARY KEY] REFERENCES auth.users(id) [ON DELETE ...]` → `X TEXT [NOT NULL|PRIMARY KEY]`
2. 兜底删除任何残留的 `REFERENCES auth.users(id)`
3. plpgsql 中承接 `auth.uid()` 的变量 `g_user_id` / `v_uid` / `v_user_id` 类型 `uuid` → `text`
4. `uuid_generate_v4()` → `gen_random_uuid()`（PG 17 内置，不依赖 uuid-ossp）
5. 删除 `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`（避免不必要的扩展权限要求）

## 9. 迁移执行记录（2026-10-22，P2 schema 已完成）

目标环境 `ulink-d1g5srvjo54b1886a`（个人版 / PG 17.11 / ap-shanghai）。

**结果：38 个迁移全部应用成功**（remote history 记录 38 条，latest `20261022000038`）。

产物：

| 项 | 数量 | 说明 |
| --- | --- | --- |
| public 表 | 11 | bookmarks / categories / custom_attributes / data_history / deleted_item_graveyard / error_logs / feedback_messages / link_check_history / public_category_shares / sibling_groups / user_security |
| RLS 策略 | 33 | 全部重建 |
| public 函数 | 11 | 含 `get_public_group` / `get_public_category` / `upsert_public_category_share` / `consume_rate_limit` / `cleanup_old_check_history` + 5 个触发器函数 |
| storage bucket | 1 | `group-images`，`public = true`（迁移 024 直接建成） |

**权限基线不变量复核（031 的核心资产，全部通过）：**

```
表                      anon_SELECT  auth_SELECT  auth_TRUNCATE  FORCE_RLS
bookmarks                  false        true         false         true
categories                 false        true         false         true
custom_attributes          false        true         false         true
data_history               false        true         false         true
deleted_item_graveyard     false        true         false         true
error_logs                 false        true         false         true
feedback_messages          false        true         false         true
link_check_history         false        true         false         true
public_category_shares     false        true         false         true
sibling_groups             false        true         false         true
user_security              false        true         false         true
```

即：anon 零表权限、authenticated 无 TRUNCATE（不能绕过 RLS）、FORCE RLS 全开。**迁移 031 在 CloudBase PG 上原样成立，不需要改写。**

**过程中唯一需要人工改的文件：**

- `006_enable_realtime.sql` → 改为 no-op。原文 `ALTER PUBLICATION supabase_realtime ADD TABLE ...`，报 `publication "supabase_realtime" does not exist (SQLSTATE 42704)`。CloudBase PG 没有该 publication，`pg_publication` 实测为空。

其余 37 个文件由 `scripts/transform-migrations.mjs` 机械适配后一次通过，无需逐个手改。

> ⚠️ 踩过的坑：`tcb db pg migration up` 在「任务提交成功但执行失败」时也会打印 `✔ Migration execution task submitted successfully`。判成功只能看 `√ migration up completed`。第一版应用脚本用了错误的判据，导致前 5 个之后的失败被误判为成功——已修正 `scripts/apply-cloudbase-migrations.sh`。

## 10. 下一步（P1 / P3 / P4）

schema 侧已就绪，剩余是代码侧：

1. **P1 驱动层**：新增 `src/lib/backend/` 四端口（PG / Auth / Storage / Functions），CloudBase 侧用 `@cloudbase/js-sdk` v3。注意 `GROUP_IMAGES_PUBLIC_PREFIX`（`src/lib/imageStorage.ts`）目前硬编码 Supabase 的 `/storage/v1/object/public/group-images/`，换平台必须同步改，且 `imageExtension.ts` 的 parseHTML 白名单依赖它。
2. **P3 云函数**：7 个 Edge Function → Node 云函数。
3. **P4 分享 SSR**：`functions/_lib/share-render.ts` 是零依赖纯函数，可直接搬进云函数；需替换 `share-cache.ts` 的 Cache API 实现。
4. **身份映射**：见 §4.1b，需新增 `legacy_identity_map` 迁移。
5. **备案前**：续费到 ≥ 12 个月 + 开启云托管固定 IP。

## 11. P1 驱动层进展（2026-10-22）

**已完成：同步数据链路的双驱动切换。**

| 文件 | 作用 |
| --- | --- |
| `src/lib/cloudbase.ts` | CloudBase 客户端边界。惰性单例 + 未配置时 null client（与 `lib/supabase.ts` 同策略，调用方无需 null 判断） |
| `src/composables/domain/syncPortCore.ts` | 同步端口的共享契约（类型 + `fetchAllPages`）。单独成文件是为了打断 `syncRemotePort ↔ syncRemotePort.cloudbase` 的 ESM 循环依赖 |
| `src/composables/domain/syncRemotePort.cloudbase.ts` | `SyncRemotePort` 的 CloudBase PG 实现 |
| `src/composables/domain/syncRemotePort.ts` | 默认端口改为**惰性按后端选择**：`VITE_BACKEND=cloudbase` → CloudBase，否则 Supabase |
| `src/__tests__/composables/syncRemotePort.cloudbase.test.ts` | 12 个契约测试 |
| `scripts/verify-cloudbase-sdk.mjs` | 对真实环境探测 SDK 运行时形状 |

**开关**：`VITE_BACKEND=cloudbase` 才切走 Supabase。**默认未开启**——auth / storage / functions 三条支路还没接，现在切换只会半残。

**实机探测结果（`node scripts/verify-cloudbase-sdk.mjs`，12/12 通过）：**

```
✔ app.rdb 是函数 / rdb.from 是函数 / rdb.rpc 是函数
✔ 终端方法齐备（from 层）— select/insert/upsert/update/delete
✔ select()/update()/delete()/upsert() 返回的构造器都带全过滤器
✔ anon 直读 bookmarks 被拒 — code=DATABASE_42501 permission denied for table bookmarks
✔ get_public_group 匿名可调 — data={}
```

两个结论值得记：

1. **过滤器挂在「终端方法返回的构造器」上，不在 `from()` 直出对象上**。`from(t).eq(...)` 不成立，必须 `from(t).select(...).eq(...)` / `.update(...).eq(...)`。端口实现正是按这个形状写的。
2. **publishable key 确实映射到 PG 的 `anon` 角色**，且 031 的 GRANT 基线在真实客户端链路上生效（`DATABASE_42501` 而非 RLS 空返回）——这是「零表权限」策略被真实验证，不只是 SQL 层自查。

**验证**：新增 12 个测试 + 既有 41 个端口测试全绿（53/53），`tsc --noEmit` 无错误，ESLint 无告警。

**与 Supabase 实现的有意差异（1 处）**：`upsert` 显式传 `onConflict: 'user_id,id'`。Supabase 那边刻意不传是历史包袱（主键 DDL 与前端资源无法原子切换），CloudBase 目标库从建表起就是复合主键，写死是确定的。

**剩余（未开始）**：Auth（CloudBase 身份认证，`signInWithOtp` 无对应物，需重新设计登录方式）、Storage（`getPublicUrl` → `createSignedUrl`/公开域名，且 `GROUP_IMAGES_PUBLIC_PREFIX` 要同步改）、Functions（3 处 `functions.invoke` → 云函数）、分享 RPC 直连（`syncShare.ts`）、以及 7 个 Edge Function 的重写。

## 12. 身份认证方案（2026-10-22 定案）

> **修正 §11 结尾的判断**：CloudBase Auth v3 是**刻意做成 Supabase 兼容**的——`signInWithPassword` / `signInWithOtp` / `signUp` / `signOut` / `getSession` / `getUser` 与 Supabase 同名同形状（都返回 `{ data, error }`）。所以「`signInWithOtp` 没有对应物、要自建邮箱验证码」是错的，**现有邮箱验证码可以原样保留**。

### 12.1 实测：auth 表面有 112 个方法，本项目需要的 10 个全在

```
✔ signInWithOtp          发验证码（email / phone）
✔ verifyOtp              校验（见下方差异）
✔ signInWithPassword     邮箱/用户名 + 密码
✔ signUp                注册（自动发码，必须走完 verifyOtp）
✔ resetPasswordForEmail  找回密码
✔ signInWithOAuth        第三方（含 signInWithWechat / weixinAuthProvider）
✔ signOut / getSession / getUser / onAuthStateChange
```

另有 `sendPhoneCode` / `signUpWithPhoneCode` / `signInWithPhoneCodeOrPassword`（短信链路）、`bindEmail` / `bindPhoneNumber` / `linkIdentity`（账号绑定）。

### 12.2 与现有代码的唯一硬差异：`verifyOtp` 是闭包，不是独立调用

现有代码（Supabase 写法）：

```ts
await supabase.auth.signInWithOtp({ email })
await supabase.auth.verifyOtp({ email, token, type: 'email' })
```

CloudBase 写法：`signInWithOtp` 的返回值 `data` 上带一个 `verifyOtp` 闭包，**messageId 已绑在闭包里**：

```ts
const { data, error } = await auth.signInWithOtp({ email })
await data.verifyOtp({ token })
```

直接调独立的 `auth.verifyOtp({ token })` 会报 `messageId is required`。这是唯一必须改的调用形状，其余基本同名。

### 12.3 四种登录方式的落地条件

| 方式 | SDK 支持 | 前置条件 | 结论 |
| --- | --- | --- | --- |
| **邮箱验证码**（现有） | ✅ `signInWithOtp({email})` + `data.verifyOtp({token})` | 控制台开启「邮箱验证码登录」+ **配置 SMTP 发信** | 保留，但要先把 SMTP 定下来 |
| **邮箱 + 密码**（新增） | ✅ `signInWithPassword({email,password})`；注册用 `signUp({email,password})` 且**必须走验证码** | 同上（注册要发码） | 可加，与验证码共用一条链路 |
| **微信扫码**（新增） | ✅ `signInWithOAuth({provider:'wechat'})` / `signInWithWechat` | **微信开放平台「网站应用」**：企业/个体户主体 + 已备案域名 + 审核通过 | **必须等备案完成**，无法提前 |
| **手机短信验证码** | ✅ `sendPhoneCode` / `signInWithPhoneCodeOrPassword` | 控制台开启短信登录；**仅上海地域可用**（本环境正是 ap-shanghai ✅） | 可加，但按条计费，见 §12.4 |

三条重要约束：

1. **注册没有「纯密码」路径**。CloudBase 的 `signUp` 本身就要发验证码，必须走完 `data.verifyOtp` 才算注册成功。这反而是好事——等于强制邮箱真实性校验。
2. **微信扫码排在备案之后**。微信开放平台「网站应用」要求已备案域名，所以顺序是：迁移完成 → 备案通过 → 申请微信开放平台网站应用 → 接扫码登录。提前做只能做代码骨架，联调不了。
3. **邮箱不需要自备 SMTP**。CloudBase 提供**零配置邮件代发**（控制台 → 身份认证 → 登录方式 → 「邮箱验证码」卡片 → 配置发件邮箱 → 选「开启邮件代发」→ 保存，1 分钟生效）。只有在要自定义发件人域名时才需填 SMTP（腾讯企业邮 `smtp.exmail.qq.com:465 SSL`）。这一条推翻了「邮箱链路被 SMTP 卡住」的顾虑。

### 12.3b 两套 API 并存，迁移走兼容层

目标环境实测的 SDK 3.10.3 里同时存在两代邮箱登录 API：

| 代数 | 发送 | 校验 |
| --- | --- | --- |
| Supabase 兼容层 | `signInWithOtp({ email })` | `data.verifyOtp({ token })`（闭包） |
| v2 原生 | `getVerification({ email })` → `verificationInfo` | `signInWithEmail({ verificationInfo, verificationCode, email })` |

现有代码用的是 Supabase 兼容层，所以**迁移只改 `verifyOtp` 的调用形状**（§12.2），不走 v2 原生那套，改动面最小。

### 12.4 短信计费（2026-10-22 查证）

CloudBase 内置短信走**资源点**，也可以用腾讯云短信套餐包：

| 渠道 | 单价 | 起售门槛 | 说明 |
| --- | --- | --- | --- |
| CloudBase 资源点 | **50 点/条 = ¥0.05** | 无 | 从套餐额度里扣。**个人版 40,000 点/月 = 800 条/月** |
| 短信自定义套餐包 | ¥0.050（1000–9999 条） | 1000 条（约 ¥50） | 按量段递减 |
| 短信固定包 1 万条 | **¥0.047/条（¥470）** | 1 万条 | 24 个月有效，3 个月内可退 |
| 固定包 10 万 / 50 万 / 100 万 / 300 万 | ¥0.045 / ¥0.045 / ¥0.043 / ¥0.041 | 对应起售量 | 单价随量递减 |

其他规则：
- 新开通按量计费环境**首月 100 条免费**
- 频率限制：同一号码 **30 秒 1 条**、**自然日 10 条**
- 个人认证用户**只能发验证码/通知，不能发营销短信**（个体户同理）
- 短信只要提交到运营商就计费，**送达失败也扣**

**对 ulink 的成本测算**：假设 100 个活跃用户、每人每月登录 4 次 = 400 条/月 ≈ ¥20/月，占个人版套餐额度的一半（20,000 点）。也就是说**短信和数据库抢同一个资源点池**——用户量一上来，19.9 的套餐会被短信吃掉。

结论：**短信登录不适合作为主力方式**。合理定位是「邮箱之外的补充通道」，且必须配频率限制（项目里已有 `consume_rate_limit` RPC 可以复用）。

### 12.5 建议的实施顺序

1. 控制台 → 身份认证 → 登录方式：开启「邮箱验证码」并点「配置发件邮箱 → 开启邮件代发」，同时开启「邮箱密码」。
2. 改 `stores/auth.ts` 的 `verifyOtp` 调用形状（§12.2），跑通邮箱两条链路。
3. 短信登录按需加，默认关闭（成本见 §12.4，与数据库抢资源点池）。
4. 微信扫码等备案通过后再接。

### 12.6 一个必须先解决的问题：用户身份对不上

登录方式定了之后紧接着就是 §4.1b 的身份映射：老用户在 Supabase 里的 `user_id` 是 uuid，在 CloudBase 重新登录后拿到的是新 `sub`。**不做映射，用户迁移后登录会看到空书架。** 这块要跟 auth 一起做，不能等。

## 13. 自定义邮件模板（2026-10-22）

结论：**正文 HTML 可以完全自定义，能做得和 Supabase 时期一模一样；但邮件主题和发件人显示名改不了。**

### 13.1 能力边界

| 项 | 能否自定义 | 说明 |
| --- | --- | --- |
| 正文 HTML（中/英各一份） | ✅ 完全自定义 | `EmailConfig.TemplateConfig.RegisterSignIn.{ZhCN,EnUS}` |
| **邮件主题 Subject** | ❌ **实际不可配** | `SubjectZhCN`/`SubjectEnUS` 写进去 `getProviders` 会**回显**，但发信引擎不采用（社区 #1559 官方工程师确认字段未暴露）。**回显 ≠ 生效**，别再被这次回显骗一次 |
| **发件人显示名** | ❌ **实际不可配** | 同上，`SenderNameZhCN` 只是回显 |
| 发件邮箱地址 | ✅ 可配（走自有 SMTP） | 平台代发时固定 `cloudbase_noreply@tencent.com`；配 SMTP 后可用 `noreply@ulink.ren` |

### 13.2 模板变量与 Supabase 不同（迁移必改）

| Supabase（Go 模板） | CloudBase | 备注 |
| --- | --- | --- |
| `{{ .Token }}` | `{{.VerificationCode}}` | **必填**，缺了配置会失败 |
| `{{ .Email }}` | `{{.Email}}` | 一致 |
| `{{ .SiteURL }}` | — **不存在** | 必须写死 `https://ulink.ren` |
| 固定「10 分钟」 | `{{.ExpireMinutes}}` | 动态 |
| — | `{{.Usage}}` | 用途说明，可选 |

### 13.3 平台硬限制（写模板时不能踩）

必须含 `{{.VerificationCode}}`，且**禁止**出现：`<script>`、`javascript:`、`onclick=`、`onload=`、`<iframe>`、`<link>`、CSS `expression()`、CSS `url()`。

> ⚠️ `url()` 被禁意味着**不能引用外部背景图**；但 `<img src="...">` 不在禁令内，所以 Logo 仍可用 `https://ulink.ren/logo.png`。

### 13.4 本仓库产物

| 文件 | 说明 |
| --- | --- |
| `cloudbase/email-templates/register-signin.zh-CN.html` | 中文模板，由 `supabase/email-templates/otp-login.html` 改写而来（保持同一套暖色卡片 + 等宽验证码框 + 暗色模式适配） |
| `cloudbase/email-templates/register-signin.en-US.html` | 英文模板，同版式 |
| `scripts/validate-email-templates.mjs` | 校验必填变量 / 禁用项 / 未知变量 / 残留 Supabase 变量。当前 2/2 通过 |
| `scripts/apply-cloudbase-email-templates.mjs` | 调 `manager-node` 的 `env.modifyProvider` 写入；`--dry-run` 可看载荷。**需要管理凭证，脚本不内置任何密钥** |

### 13.5 两条落地路径

1. **控制台**（无需密钥）：身份认证 → 登录方式 → 邮箱验证码 → 配置发件邮箱 → 开启「邮件代发」→ 把两个 html 文件内容分别贴进中文/英文模板输入框 → 保存。
2. **脚本**：`npm i -D @cloudbase/manager-node`，跑 `node scripts/apply-cloudbase-email-templates.mjs`。**不需要额外申请密钥**——脚本默认复用本机 `tcb` CLI 已登录的临时 STS 凭证（`~/.config/.cloudbase/auth.json`）。

### 13.6 实测踩坑记录（2026-10-22，全部真实报错）

按官方文档直接写会连续踩四个坑，最终落库的写法与文档有出入：

| # | 坑 | 现象 | 正确做法 |
| --- | --- | --- | --- |
| 1 | 把模板塞进 `Config.TemplateConfig` | `UnknownParameter: The parameter Config.TemplateConfig is not recognized` | EMAIL 专属配置在 **provider 顶层 `EmailConfig`**，`Config` 是给 OAUTH/OIDC/SAML 的。以 `@cloudbase/manager-node/types/env/index.d.ts` 为准，别信文档页 |
| 2 | 只传 `On: 'TRUE'` 就开 | `邮箱登录开启前，请配置发件人` | 要同时给 `EmailConfig.On: 'TRUE'`（平台代发） |
| 3 | 模板用整篇 HTML 文档 | `email template config invalid: register_sign_in template zh_CN: template contains forbidden pattern: (?i)<meta` | 只能提交 **HTML 片段**：`<style>` + 正文表格；不要 doctype/html/head/title/body，**且 `<meta>` 被禁**（注释里出现 `<meta` 字样也会被正则命中） |
| 4 | `On` 与模板放同一个请求 | API 返回成功但模板**静默不落库**（回读是旧值） | **分两次调用**：先开开关，再写模板 |

### 13.7 当前生效状态（已复核）

```
provider email      On = TRUE                     # 邮箱登录已开启
EmailConfig.On      = TRUE                       # 平台代发（零配置）
发件地址             = cloudbase_noreply@tencent.com
模板 ZhCN            = 5134 字符（含 {{.VerificationCode}}）
模板 EnUS            = 5429 字符（含 {{.VerificationCode}}）
主题                 = 与链 ulink 验证码 / Your ulink verification code
发件人显示名          = 与链 ulink / ulink
```

想要 `noreply@ulink.ren` 这个发件地址，需要改为自有 SMTP（腾讯企业邮 `smtp.exmail.qq.com:465 SSL`），`EmailConfig.SmtpConfig` 填 SenderAddress / ServerHost / ServerPort / AccountUsername / AccountPassword，并把 `EmailConfig.On` 置 `FALSE`。

### 13.8 切换到自有 SMTP（企业邮）

**Supabase 时期的 SMTP 配置拿不到**：`supabase/config.toml` 里的 `[auth.email.smtp]` 是注释掉的官方模板（占位是 sendgrid），真实凭据配在 Supabase Dashboard，不在代码库里。

需要的 4 项（只有第 3 项是秘密）：

| 项 | 说明 | 默认值 |
| --- | --- | --- |
| 发件邮箱地址 | 如 `noreply@ulink.ren`，必须是企业邮里真实存在的账号 | — |
| SMTP 账号 | 通常与发件地址相同 | — |
| **SMTP 密码 / 授权码** | 唯一秘密，**不要贴聊天记录**，写进 `.env.local` | — |
| 主机 / 端口 / 加密 | 腾讯企业邮 | `smtp.exmail.qq.com` / `465` / `SSL` |

交接方式：把上面几项写进 `.env.local`（已 gitignore），然后跑

```bash
node scripts/apply-cloudbase-email-templates.mjs --dry-run   # 先看载荷
node scripts/apply-cloudbase-email-templates.mjs             # 写入
```

脚本检测到 `CLOUDBASE_SMTP_SENDER` / `_USER` / `_PASS` 就自动切到自有 SMTP（把 `EmailConfig.On` 置 `FALSE`），否则保持平台代发。

**发信前还要确认 DNS**（本环境查不了 DNS，需在 DNSPod 控制台核对）：

- `MX` → 企业邮收信（`mxbiz1.qq.com` / `mxbiz2.qq.com`）
- 主域 `TXT` 有 `v=spf1 include:spf.mail.qq.com ~all`
- `_dmarc` 有 `v=DMARC1` 记录
- 企业邮控制台里开启 DKIM 并加对应 `xxx._domainkey` TXT

> **DKIM 后台入口（2026-10-22 实测核对，官方帮助页原文）**：腾讯企业邮已并入企业微信，路径是
> **企业管理后台 → 协作 → 邮件 → 安全管理 → DKIM验证 → 配置**（`https://work.weixin.qq.com/wework_admin/frame`）。
> 老版独立后台在 `https://exmail.qq.com/` 登录后进「管理后台」。
> 官方帮助：https://open.work.weixin.qq.com/help2/pc/19647
>
> **现状（2026-10-22 12:44 DoH 实测，四项全绿）**：
> `MX ✔`（`mxbiz1/2.qq.com`）/ `SPF ✔`（`v=spf1 include:spf.mail.qq.com ~all`）/
> `DKIM ✔`（选择器 `gfhp2610`，218 字符，1024-bit RSA）/ `DMARC ✔`（`v=DMARC1; p=none; rua=mailto:dmarc@ulink.ren; adkim=s; aspf=s; pct=100`）
> 复查命令：`node scripts/verify-mail-dns.mjs`
>
> 腾讯控制台的 DKIM 状态显示「验证中」是**平台侧轮询滞后**（DNS 已能查到正确值），最终以真实发信头里的 `DKIM-Signature` + 收件端 `Authentication-Results: dkim=pass` 为准。

### 13.11 邮件链路验证工具

| 脚本 | 用途 |
| --- | --- |
| `scripts/verify-mail-dns.mjs` | 查 MX / SPF / DKIM（10 个选择器，支持 `DKIM_SELECTORS=` 追加）/ DMARC |
| `scripts/verify-smtp-auth.mjs` | 直连 SMTP 做 AUTH LOGIN，隔离「凭据问题 vs 平台问题」 |
| `scripts/send-test-mail.mjs` | 走企业邮 SMTP 真发一封测试信，用于看信头 |

**为什么测试信要单独发**：站点的「发送验证码」目前仍走 Supabase（`VITE_BACKEND` 未切），验不了 CloudBase → 企业邮 这条新链路。`send-test-mail.mjs` 直接走 SMTP，能独立证明企业邮能以 `ulink.ren` 身份投递。

实测：`235 Authentication successful` → `250 Ok: queued as`，投递成功（2026-10-22 12:4x）。

缺 SPF/DKIM 时邮件能发出去但容易进垃圾箱——发信域名和收件域名不是同一个时尤其明显。

### 13.9 Supabase 的 SMTP 配置其实能取到（实测路径）

虽然 `config.toml` 里没有，但**管理 API 能读到完整配置**：

```bash
GET https://api.supabase.com/v1/projects/<project-ref>/config/auth
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
```

`project-ref` 从 `VITE_SUPABASE_URL` 里解析，token 在 `.env`（`sbp_` 前缀）。实测返回：

| 字段 | 实际值 |
| --- | --- |
| `smtp_host` / `smtp_port` | `smtp.exmail.qq.com` / `465`（SSL） |
| `smtp_user` / `smtp_admin_email` | `noreply@ulink.ren` |
| `smtp_sender_name` | `与链 ulink` |
| `mailer_subjects_magic_link` | `与链 ulink 登录验证码` |
| `smtp_max_frequency` | 60（秒） |
| `smtp_pass` | 有值，**未打印未落盘** |

脚本已支持一键沿用：`node scripts/apply-cloudbase-email-templates.mjs --from-supabase`（先加 `--dry-run` 看载荷）。

⚠️ **Supabase 里存的那份密码是旧的**：CloudBase 返回 `邮箱SMTP配置验证失败: smtp auth LOGIN PLAIN 535`，我用 `scripts/verify-smtp-auth.mjs` 直连 `smtp.exmail.qq.com:465` 复现了同样的 `535`。两个不同出口 IP 都失败 → 与 CloudBase 无关、与 IP 白名单无关。

**已解决**：换用企业邮的「客户端专用密码」（16 位）后，直连测试返回 `235 Authentication successful`，CloudBase 侧校验也通过。新密码写在 `.env.local` 的 `CLOUDBASE_SMTP_PASS`（脚本里**环境变量优先级高于 Supabase 存档值**，正是为了覆盖旧密码）。

排查位置（企业邮后台）：账号的「客户端设置」是否开启 SMTP；是否启用了「客户端专用密码」（启用后必须用专用密码，不能用登录密码）；密码是否已变更。

### 13.10 当前生效状态（自有 SMTP，2026-10-22 12:00 复核）

```
provider email   On = TRUE
EmailConfig.On   = FALSE                          # 不用平台代发
发件地址          = noreply@ulink.ren
SMTP 主机         = smtp.exmail.qq.com:465 (SSL)
模板 ZhCN         = 5134 字符
模板 EnUS         = 5429 字符
主题              = 与链 ulink 登录验证码 / Your ulink verification code
发件人显示名        = 与链 ulink / 与链 ulink
```

与 Supabase 时期完全对齐：同一个发件地址、同一个发件人名、同一个主题文案（`mailer_subjects_magic_link` = `与链 ulink 登录验证码`）。

一键复现：`node scripts/apply-cloudbase-email-templates.mjs --from-supabase`（读 Supabase 的 host/port/user/发件名/主题，密码取 `.env.local`）。

**仍待确认**：CloudBase 侧的发信频率限制（Supabase 时期是 `smtp_max_frequency=60` 秒、`rate_limit_email_sent=2` 封/小时，非常低）；DNS 的 SPF/DKIM/DMARC 需在 DNSPod 控制台人工核对（本环境查不了 DNS）。

### 13.12 验证码「开头多一个分号」与「通知栏看不到验证码」（2026-10-23）

**问题 1：邮件正文开头多出一个 `；`**

根因是模板第 9 行写成了 `-->;` —— 注释闭合符后面多打了一个分号，它不在任何标签里，被当成正文渲染，于是整封邮件以 `;` 开头。

已修：两个模板都删掉该字符；`scripts/validate-email-templates.mjs` 增加两条回归守卫：

- 剥掉注释后，**第一个标签之前**不允许出现非空白文字（正是 `-->;` 的形态）
- **`</style>` 之后、下一个标签之前**不允许出现非空白文字

> ⚠️ 写注释时也不要出现完整的注释闭合符字面量，否则注释会被提前截断，后半段文字直接漏进正文（本次修模板时就踩了一次，被上面第一条守卫抓到）。

**问题 2：只有打开邮件才看得到验证码**

不能靠改主题解决 —— CloudBase 的邮件主题/发件人显示名虽然写进 API 会回显，但发信引擎并不采用（见 §13.1）。**收件箱列表和系统通知里那行摘要，取的是正文第一段文本**，原文里这段是「你的与链验证码是 123456…」，但它前面还躺着那个游离的 `;`，摘要就被挤成了分号。

解法是**隐藏摘要（preheader）**：在正文最顶部放一段 `display:none` 的文字，里面写验证码。人眼看不见，但 Gmail / Outlook / Apple Mail 的列表与通知都会拿它当摘要——这是邮件营销里用了十年的标准做法（不是 hack）。

已按跨客户端的最佳实践加固：

| 写法 | 作用 |
| --- | --- |
| `display:none !important` | 不带 `!important` 会被 Gmail 网页版 / Yahoo 覆盖，导致隐藏文字直接显示在正文里 |
| `mso-hide:all` | 挡住 Outlook 的 Word 渲染内核 |
| `max-height:0;max-width:0;overflow:hidden` | 表达层兜底 |
| `font-size:1px;line-height:1px;color:#F5EFEA` | 万一被转发/回复时样式丢失，也不明显漏出来（颜色取邮件背景色） |
| 末尾 `&#847;` 零宽字符 | 占位，防止正文字符串顶进摘要 |
| `aria-hidden="true"` | 读屏软件跳过 |

> **为什么没改成正文字序**：一度试过把验证码块挪到正文最前（这样通知栏一定读得到），但那会改掉邮件本身的视觉层级。隐藏摘要能同时满足「外观不变」和「通知可见」，所以回退成原版式 + 隐藏摘要。若某些客户端实测仍不读 preheader，再退回「验证码上移」这一版即可。

自检数据（Chromium 渲染）：隐藏块 `getBoundingClientRect()` 为 0×0；可见文本 `innerText` 开头仍是 `与链 ulink 验证码 你的登录邮箱：…`，页面外观与原版一致。

**仍待实证（可选实验）**：主题里放 `{{.VerificationCode}}` 会不会被替换。CloudBase 文档只写了正文变量，但主题字段能回显，只有发一封才知道。脚本已加开关：

```bash
node scripts/apply-cloudbase-email-templates.mjs --from-supabase --dry-run --subject-with-code
node scripts/apply-cloudbase-email-templates.mjs --from-supabase --subject-with-code
# 发一封给自己：主题变成「482913 是你的与链验证码」= 支持；原样打出 {{.VerificationCode}} = 不支持
node scripts/apply-cloudbase-email-templates.mjs --from-supabase   # 回退
```

**部署注意（新增防呆）**：线上用的是自有 SMTP（`noreply@ulink.ren`）。直接跑脚本时若解析不到 SMTP 凭据，会把 provider 悄悄改回平台代发（发件地址变成 `cloudbase_noreply@tencent.com`）。脚本现在会直接报错退出，必须显式加 `--from-supabase`（或补齐 `.env.local` 的 `CLOUDBASE_SMTP_*`），或用 `--allow-relay` 表示确实要平台代发。

### 13.13 重置密码邮件是「通用模板」——少配了 `DefaultTpl`（2026-10-24）

**现象**：设置面板「设置登录密码」点发送验证码，收到的邮件是平台默认的朴素模板，不是我们的品牌卡片。

**根因**：`EmailTemplateConfig` 只有**两个**槽位（`@cloudbase/manager-node/types/env/index.d.ts`）：

| 槽位 | 覆盖范围 |
| --- | --- |
| `RegisterSignIn` | 注册 / 验证码登录 |
| `DefaultTpl` | **其余全部用途**，包括 `resetPasswordForEmail` 发出的重置密码验证码 |

我们此前只写了 `RegisterSignIn`。而「设置登录密码」走的正是 `authDriver` 的 `resetPasswordForEmail`（客户端拿到 data 上的 `updateUser` 闭包再改密），于是落进空的 `DefaultTpl` → 平台通用模板，品牌样式和我们做的隐藏摘要（通知栏可见验证码）全部失效。

**修法**：`apply-cloudbase-email-templates.mjs` 现在把同一份 HTML 同时写进两个槽位，复核条件也改成「两份都得 >1000 字符」。`--status` 会额外打印 `DefaultTpl` 长度，为空时直接标红提示。

> 复用同一份模板是刻意的：正文文案是「与链 ulink 验证码 / 你的登录邮箱 / N 分钟内有效」，对重置密码同样成立，没必要维护第二套版式。

## 14. 登录驱动层（2026-10-22 完成）

`stores/auth.ts` 不再直接依赖 `supabase.auth.*`，改由 `src/lib/authDriver.ts` 提供统一接口。默认仍是 Supabase，`VITE_BACKEND=cloudbase` 才切。

### 14.1 为什么必须单独一层

两边最大的差异是 **`verifyOtp` 的形态**：

| | Supabase | CloudBase |
| --- | --- | --- |
| 发送 | `auth.signInWithOtp({ email, options })` | 同名同形状 |
| 校验 | `auth.verifyOtp({ email, token, type: 'email' })` 独立调用 | **`signInWithOtp` 返回值 `data` 上的闭包** `data.verifyOtp({ token })`，messageId 已绑定 |
| 直接独立调 `verifyOtp` | 正常 | 报 `messageId is required` |

所以驱动内部要**按邮箱暂存** sendOtp 拿到的闭包。暂存语义（已用单测锁住）：

- 没 sendOtp 就 verifyOtp → 返回「验证码已失效，请重新获取」，不发请求
- 按邮箱隔离（A 的闭包不能用于 B）
- 校验成功 → 清掉暂存；失败 → **保留**，允许用户重试
- signOut → 清空
- 平台没返回闭包（SDK 降级）→ 不 crash，给可读提示

### 14.2 接入的 7 个调用点

`getSession` / `onAuthStateChange` / `updateUser` / `signInWithOtp` / `verifyOtp` / `signOut` / `signInWithOAuth`。

**Supabase 分支的调用形状与改造前逐字一致**——这是硬约束，`src/__tests__` 里十余个用例断言了这些调用的参数。

### 14.3 会话形状补齐

CloudBase 的 user 没有 `user_metadata`，而 `displayName` / `avatar` 计算依赖它。驱动在边界处补空对象并做一次双重断言，不向上层扩散。

### 14.4 验证

| 项 | 结果 |
| --- | --- |
| 新增 `authDriver.cloudbase.test.ts` | 14/14 通过 |
| `stores` + `lib` 全量回归 | 86 文件 / **1142 通过 + 2 跳过** |
| `tsc --noEmit` | 干净 |
| ESLint（3 个改动文件） | 无告警 |

### 14.5 邮箱密码登录（已完成）

产品决策（用户 2026-10-22 定）：**密码随时可设，但老用户走「点密码登录 → 失败 → 被引导用验证码登录 → 登录后设密码」这条路径**，不做强制弹窗。

驱动新增三个方法：`signInWithPassword` / `sendPasswordReset` / `confirmPasswordReset`。store 同步暴露，且**复用验证码那套失败计数与锁定**（同一账号的凭据尝试共享配额：5 次锁 30s，再犯锁 5min）。

**设密码必须走「验证码 + 新密码」两步——不是设计选择，是平台逼的**：

CloudBase 的 `updateUser` **明确拒绝 `password` 参数**（实测报错原文：「updateUser 不支持更新密码，检测到传入了 "password" 参数。如需修改密码请使用 resetPasswordForOld（旧密码修改）、resetPasswordForEmail（验证码重置）或 reauthenticate」）。三条路里只有 `resetPasswordForEmail` 适合老用户（他们没有旧密码）。

而 `resetPasswordForEmail(email)` 返回值上又是一个闭包（和 `signInWithOtp` 同款）：

```ts
const sent = await auth.resetPasswordForEmail(email)
await sent.data.updateUser({ nonce: 验证码, password: 新密码 })   // ← 闭包参数是 nonce，不是 token
```

所以驱动里又多一处「按邮箱暂存闭包」的机制，与 OTP 那套并列。Supabase 侧等价实现是 `verifyOtp({type:'recovery'})` + `updateUser({password})`，差异由驱动屏蔽。

**UI**：

| 位置 | 改动 |
| --- | --- |
| `AuthModal.vue` | 加「验证码登录 / 密码登录」两个 tab；密码模式有密码框与引导文案；登录成功的收尾抽成 `schedulePostLogin()` 供两种方式复用 |
| `SettingsPanel.vue` | 账号区加「设置登录密码」入口：点开后是**发验证码 → 输验证码 + 新密码 → 保存**的两步面板 |
| `styles/settings.css` | 新增 `.sp-pw-edit` 等样式 |

**「忘记密码」不再单独做入口**：CloudBase 发的是验证码不是链接，独立入口就得再做一套输码界面；而「验证码登录 → 设置里重设密码」本来就是同一条路径。登录弹窗的引导文案里已经说明了这一点。

**老用户迁移路径**：验证码登录 → 设置面板 → 发验证码 → 设新密码。CloudBase 的 `signUp` 本身要发验证码，**不存在纯密码注册**，与 Supabase 一致。

**「没设过密码」怎么识别**：CloudBase 返回的凭据错误无法可靠区分「密码错」和「还没设过密码」，所以不猜错误码，统一给引导语——

> 邮箱或密码不正确。若这是你第一次用密码登录，请先用验证码登录，再在设置里设置密码。

### 14.6 昵称/头像在重登后退回默认（2026-10-24）

**现象**：退出登录后用密码（或验证码）重新登录，名字变成邮箱前缀、头像变默认。

**三个原因叠在一起**：

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `signOut()` | 清掉 `lv_user_nickname` / `lv_user_avatar`（防换号残留），本地副本没了 |
| 2 | CloudBase 驱动 `updateUserMeta` | 按 Supabase 语义发 `{ data: { display_name, avatar } }`。CloudBase 的 `updateUser` 收**扁平**字段且键名是 `nickname` / `avatar_url`（见 SDK `UpdateUserReq = UserAttributes`）→ 资料根本写不进云端 |
| 3 | `stores/auth.ts` | 读资料只认 `display_name` / `avatar`；CloudBase 返回的是 `nickName` / `avatarUrl`（驼峰）甚至顶层 `name` |

于是「本地被清 + 云端没写进去 + 云端键名又读不到」，重登必然退回默认。

**修法**：

- 驱动把 `display_name → nickname`、`avatar → avatar_url` 映射成扁平请求；`avatar_url` 若被平台按 URL 格式拒掉（本项目存的是 emoji），退一步只写昵称，别让整次保存失败
- 读取侧统一走 `_metaDisplayName` / `_metaAvatar`，兼容 `display_name | nickname | nickName | name` 与 `avatar | avatarUrl | avatar_url | picture`，并回落到用户顶层 `name` / `displayName`
- 登录事件里若 `session.user` 只带最小字段，`onAuthStateChange` 会补一次 `getUser()` 把完整资料捞回来（先同步交付首帧，再补一次回调）

> 已受影响的老用户：云端本来就没存过资料，需要在设置里重新填一次昵称/头像，之后即可跨设备保留。

## 15. 数据迁移与身份映射（2026-10-22 完成）

### 15.1 导出：不需要 Docker、不需要数据库密码

`supabase db dump` 依赖 Docker（本机没有），改用**管理 API 的 SQL 端点**：

```http
POST https://api.supabase.com/v1/projects/<ref>/database/query
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
{ "query": "select coalesce(json_agg(t),'[]'::json) as rows from public.bookmarks t" }
```

一条 `json_agg` 就把整表取成 JSON。脚本 `scripts/migrate-supabase-data.mjs`，导出落 `cloudbase/data-export/`（已 gitignore，含用户内容）。

### 15.2 导入：三个坑

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| Windows 上 `tcb` 是 bash 包装脚本 | `spawnSync tcb ENOENT` | `execFileSync('bash', [tcb路径, ...])`，保留 argv 不经过 shell |
| `order` 是保留字 | `syntax error at or near "order"` | 所有列名加双引号 |
| **jsonb 列写空字符串** | `invalid input syntax for type json (22P02)` | jsonb 列一律 `JSON.stringify` 后再包引号（空串要写成 `""`） |

### 15.3 SQL 长度限制 + 超长字段分块

实测 **CloudBase 的 `ExecutePGSql` 对 SQL 文本长度有限制**，约 10KB 出头就会被截断，报 `unterminated quoted string` 或 `syntax error at end of input`。两个应对：

- 正常行按**字符长度**攒批（不是按行数），单批控制在 6KB
- 单个字段就超长的行：实例里有个书签的 `icon` 是 base64 内联图，**一个字段 10706 字符**。做法是先把该字段写成空串插入，再用 `SET icon = icon || '片段'` 分 1200 字符追加——追加是服务端拼接，任何单条 SQL 都不超限，内容一字不丢

导入结果（与 Supabase 逐表对齐）：

```
bookmarks 235 / categories 33 / sibling_groups 10 / custom_attributes 24
user_security 3 / deleted_item_graveyard 21 / public_category_shares 2
超长 icon 字段长度 10706（原样保留）
```

### 15.4 身份映射

`cloudbase/migrations/20261022110001_legacy_identity_map.sql`：

- 表 `legacy_identity_map(legacy_uuid, email, cb_sub, claimed_at)`
- **不给 anon / authenticated 任何直接权限**（读也不行，避免邮箱↔uid 关联被枚举），只有 SECURITY DEFINER 函数能碰
- `claim_legacy_identity()` 无参：uid 取 `auth.uid()`、邮箱取 JWT 的 `auth.email()`，**不信任客户端入参**；命中未认领记录后把各表 `user_id` 从旧 uuid 改写成新 sub，再落 `claimed_at` 防重复
- `legacy_identity_status()` 只回聚合数，不暴露别人的邮箱或 uuid

已写入 5 条映射（5 个老用户），当前 0 条已认领。

### 15.5 顺带修掉一个真 bug：彻底删除完全不可用

`032` 迁移的 `record_permanent_delete` 守卫写成：

```sql
IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN ...
```

Supabase 里 `auth.users.id` 是 uuid、与本项目 `user_id` 同型，能编译；**CloudBase 里 `auth.users.id` 是 bigint 而 `user_id` 是 text**，PostgreSQL 直接报 `operator does not exist: bigint = text (42883)`。

关键在于这个错误发生在**语句规划阶段**——只要对 `bookmarks` 等表执行 DELETE，哪怕守卫逻辑永远不会进入分支，整条语句也会失败。后果是「彻底删除」在 CloudBase 上完全不可用，同步的物理删除也会挂。

修复（`20261022120001_fix_permanent_delete_user_check.sql`）：守卫改为比对 `auth.users.sub`（text）。验证：DELETE 从报错变成正常执行，`bookmarks` 计数回到 235。

### 15.6 客户端认领（已完成）

认领挂在 `useCloudSync.initialSync()` 的最前面——**这是唯一同时覆盖「登录成功」与「会话恢复/启动」两条路径的位置**，而且早于任何按 `user_id` 的读写（顺序错了 RLS 会把未改写的行全部过滤掉，用户看到空书架，随后对账还会把本地数据当「云端已删」）。

```
initialSync()
  └─ claimLegacyIdentity()   ← 仅 CloudBase 后端；模块级 _claimTried 保证一次
       └─ rpc('claim_legacy_identity')  → { claimed, moved: {bookmarks: 235, ...} }
  └─ pullChanges() / _enqueueMissingToCloud() / pushFromQueue() …
```

- 驱动新增 `claimLegacyIdentity()`：Supabase 分支返回 `not_applicable`（无操作），CloudBase 分支走 `rdb.rpc`
- 结果存 `useCloudSync().lastClaim`，登录成功后由 `AuthModal.schedulePostLogin` 弹 toast「已恢复 N 条历史数据」
- `_claimTried` 为模块级守卫，`__resetInitialSync()` 一并复位（供测试）

**验证**：驱动测试 22 个（含认领 3 个：moved 透传 / 无待认领带 reason / rpc 报错不抛）；`composables + stores + components + lib` 全量 **268 文件 / 3876 通过 + 2 跳过**；`tsc --noEmit` 干净；ESLint 零告警。

> 过程中修掉两处提示不生效的问题，都很隐蔽：
>
> 1. `lastClaim` 原本是 composable 内的 ref，但 `initialSync` 有模块级 `_initialized` 幂等守卫——只有**第一个**实例真正跑同步，后创建的实例（登录弹窗）读到的永远是 null，toast 永远不弹。改成模块级 `_lastClaim` 后才生效。
> 2. `AuthModal.timer.test.ts` mock 了精简版 `useCloudSync`，没有 `lastClaim` 字段，直接 `.value` 会抛。组件侧改用可选链——新增返回值不该让既有 mock 崩掉。

## 16. Edge Functions → CloudBase 云函数（进行中）

### 16.1 为什么不能复用 Supabase 的运行时

7 个 Edge Function **每一个都走 `supabase.auth.getUser()` 鉴权**。迁移后前端带的是 CloudBase token，这些函数会全部变成「未登录」。要么双登录（不现实），要么改鉴权——一旦改鉴权就等于换骨架。

所以结论是 **复用代码、不复用运行时**：

| 函数 | 规模 | 能搬走的 | 必须换的 |
| --- | --- | --- | --- |
| `report-error` | 158 行 | IP 哈希限流、含密丢弃、字段裁剪 | 鉴权、写库 |
| `check-link` | 303 行 | 探测/超时/判定/限流 | 鉴权、写库 |
| `mimo-chat` | 146 行 | 模型白名单、转发 | 鉴权、密钥托管 |
| `jina-proxy` | 152 行 | 代理与裁剪 | 鉴权 |
| `extract-video` | 311 行 | 提取逻辑 | 鉴权 |
| `send-feedback` | 364 行 | 表单/邮件逻辑 | 鉴权 |
| `share-html` | 2359 行 | —— | **直接丢弃**（Cloudflare Pages 版是终态） |

真正要搬的是 ~1434 行 / 5 个函数。`functions/_lib/` 下的零依赖纯函数跨运行时可用，直接 import。

**不建议留 Supabase 跑**的三条硬理由：双后端运维（双密钥/双账单/双故障）、数据分裂（`error_logs` 写回 Supabase 而主库在 CloudBase）、以及**备案后大陆用户访问 `*.supabase.co` 的可达性没有保障**。

### 16.2 HTTP 云函数的形态（踩坑记录）

| 项 | 结论 |
| --- | --- |
| 入口形态 | **HTTP 函数是 `http.createServer` 监听 9000**，不是 `exports.main(event, context)`（那是 Event 函数） |
| 凭据 | HTTP 函数**不能**走 Event 函数的免密运行时，必须显式凭证：`CLOUDBASE_APIKEY`（服务端 API Key，等价 service_role，绕过 RLS） |
| 部署 | `tcb fn deploy <name> --dir <folder> --httpFn --path /xxx --runtime Nodejs20.19` |
| ⚠️ 路径 | `--path` **必须以 `/` 开头**；且在 Git Bash 下 `/xxx` 会被 MSYS 路径转换吃掉，必须 `MSYS_NO_PATHCONV=1` |
| ⚠️ 启动脚本 | Web 函数需要 **`scf_bootstrap`**；且 CLI 是按**当前工作目录**找它，不是 `--dir`。要在函数目录里执行 deploy，否则交互式问「Create scf_bootstrap?」并挂死 |
| ⚠️ **路由类型** | `--path` 建出来的路由是 `SCF`（Event）类型，而 `--httpFn` 建的是 Web 函数，**两者不匹配 → 网关回 `FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid`**。必须 `tcb routes edit` 把 `upstreamResourceType` 改成 `WEB_SCF` |
| ⚠️ 交互提示 | `tcb config update fn`（有环境变量时）与 `tcb routes edit` 都会交互式确认，管道里必须喂一个 `\n` |
| 配置 | `cloudbaserc.json` 的 `functions[].envVariables`；密钥不进仓库，用完即删 |
| 自检 | `tcb fn invoke <name> --params '{...}'` 绕过网关直调，可区分「函数坏」还是「路由坏」 |

### 16.3 report-error 的迁移决策

业务逻辑原样搬（IP 哈希 DB 计数限流 1 分钟 30 条、H9 含密丢弃、字段裁剪、028 全局熔断兜底）。

**一个刻意的降级**：`user_id` 一律落 `NULL`。原实现靠 `auth.getUser(token)` 解析真实 uid 防伪造；CloudBase 的 token 校验需要额外密钥/接口，v1 **不做「不验签就采信」的中间态**——那比不填更糟，给了伪造者可乘之机。错误日志有 `ip_hash` 足够定位，等接上 token 校验再补归属。

### 16.4 客户端接线

`src/lib/cloudbase.ts` 新增 `getCbFnBase()` / `invokeCbFunction(name, body, signal)`，返回形状刻意对齐 `supabase.functions.invoke` 的 `{ error }`，让 `errorReporter.ts` 的超时/竞速逻辑**不分支直接复用**：

```ts
const invokeP = Promise.resolve(
  isCloudBaseBackend()
    ? invokeCbFunction('report-error', body, signal)
    : supabase.functions.invoke('report-error', { body, signal }),
)
```

函数基址走 `VITE_CLOUDBASE_FN_BASE`（形如 `https://<env>.service.tcloudbase.com`）。
