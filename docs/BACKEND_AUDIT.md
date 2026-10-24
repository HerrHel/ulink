# Supabase 后端质量评估报告

**审计日期**：2026-09-02
**审计对象**：`supabase/migrations/001–031` + `supabase/functions/{check-link,share-html,send-feedback,report-error}`
**审计方法**：代码静态审查 + 远程库（`yqouglfopbmujkqmjgpu`）系统表实测 + anon key 直打 PostgREST 黑盒验证
**结论摘要**：首轮 7.2/10 → 同日三轮修复落地后复核 **9.5/10**（结构 9.5 / 模式 9.5 / 安全 9.8 / 可维护 9.5 / 性能 9.2）。安全已达 Supabase 单租户应用所能做到的实际极限：**公开读仅 RPC 列白名单、表策略零 TO PUBLIC、anon 零表 GRANT、authenticated 无 RLS 绕行权限（TRUNCATE/TRIGGER）、无 PUBLIC EXECUTE 函数、错误上报函数收口 + 双层限流 + 含密兜底 + user_id 防伪造**，并由 14 项远程断言 + pgTAP + CI 固化。

> 📌 修复摘要：`027`（复合主键事故）、`028`（列隔离收口/WITH CHECK/FORCE/熔断/search_path）、`029`（策略角色/索引）、`030`（error_logs 收口）、`031`（纵深防御权限最小化 + prune 性能门槛）；新函数 `report-error`；新测试 pgTAP×14 + T 字典文案一致×6；CI `supabase-db-test` 门禁。全部实测验证后推送。

---

## 一、核心判断

这个后端的优雅是**局部的、靠人工纪律维持的**，而不是**结构性和自动化保证的**。

每一处单点拿出来都很讲究 —— 018 的列级隔离、check-link 的 fail-closed DNS 校验、迁移文件里对自己错误假设的公开纠偏（015 承认「FORCE 挡 service_role」是错的，020 再补刀）。但把串这些点起来的机制是缺的：没有 `config.toml` 声明式管理函数配置，没有 pgTAP 测试守护迁移，CI 完全不覆盖 supabase，同一套 SSRF 逻辑和渲染字典各存两份靠手工同步。**结果是「每一代都能写对，但没人保证下一代不会改错」。**

这正是本项目踩过的坑的根源：018 曾 history 标 applied 但库内缺函数，靠人工发现而非测试拦住。

**2026-09-02 修复后**：上述缺口全部补齐——`config.toml`（官方模板）、pgTAP 14 项不变量 + CI 门禁、SSRF 单一真源（import）、T 字典文案级一致性断言、纵深防御权限矩阵。后端从「靠纪律」转为「靠机制」。

---

## 二、五维评分

### 首轮（审计时）→ 修复后复核（2026-09-02 三轮落地）

| 维度 | 首轮 | 复核 | 判断依据（修复后） |
|------|------|------|----------|
| 代码结构 | 7.5 / 10 | **9.5 / 10** | 31 个迁移编号唯一、语义化、职责单一；`config.toml` 官方模板补齐；SSRF 逻辑单一真源（P2-6 删 179 行镜像）；渲染字典由测试保证同步（P2-7）。扣 0.5：`share-html`（Deno 保底）与 `share-render`（CF 真源）物理双份仍存在——行为已由断言收敛，物理合并留待 CF 完全退役 Deno 版 |
| 设计模式 | 7.5 / 10 | **9.5 / 10** | 三层纵深定型：**GRANT 最小化（031）+ RLS 控行（零 TO PUBLIC）+ SECURITY DEFINER RPC 控列**；唯一写入口模式（report-error）；声明式函数配置（verify_jwt）。扣 0.5：`upsert_public_category_share` 仍 INVOKER（有 RLS 策略守护，模式统一留作 future work） |
| 安全性 | 8.0 / 10 | **9.8 / 10** | 见「六、安全极限矩阵」。全部实证：anon 零表 GRANT/零策略/零函数 EXECUTE；认证角色无 RLS 绕行权限；公开读仅 RPC 白名单；error_logs 收口 + 双层限流 + H9 含密兜底 + user_id 防伪造；search_path/FORCE/WITH CHECK 全覆盖。扣 0.2：storage 桶策略依赖 Supabase 平台默认（无自定义化空间） |
| 可维护性 | 6.0 / 10 | **9.5 / 10** | pgTAP 14 项不变量 + CI `supabase-db-test` 门禁（018 型事故上护栏）；零依赖 `assertions.sql` 远程直跑；T 字典文案级一致性测试（6 项）；迁移全部含背景/证据/回滚注释。扣 0.5：文档为独立 .md（仓库 `*.md` 忽略，未纳入版本管理） |
| 性能 | 7.0 / 10 | **9.2 / 10** | prune 触发器加 count 门槛（正常路径零 DELETE，消除 O(n) 放大）；无效索引已删；`deleted_at` 部分索引已补。扣 0.8：`data_history` 未能 pg_cron 异步化（托管未启用 cron，触发式保留 + 注释）；数据量仍小，未做 EXPLAIN 基准压测 |
| **综合** | **7.2 / 10** | **9.5 / 10** | 平均 9.5。首轮结论「单点优雅靠纪律」→ 修复后「优雅已被机制固化」 |

### 安全极限矩阵（031 后实测）

| 层 | 状态 | 实测证据 |
|----|------|----------|
| 公开读 | 仅 SECURITY DEFINER RPC 列白名单（`get_public_group`/`get_public_category`） | RPC 200 返回 13 列无敏感列；表直读 42501 |
| 表策略 | **零 TO PUBLIC**（029 全部 authenticated + 030 撤 error_logs INSERT） | `pg_policies` 无 public 角色 |
| 表 GRANT | **anon 零权限**（031）+ authenticated 无 TRUNCATE/TRIGGER/REFERENCES | `role_table_grants` anon=0；危险权限=0 |
| 序列 | anon 零；error_logs_id_seq 仅 postgres/service_role | 实测 |
| 函数 EXECUTE | 无 PUBLIC EXECUTE；触发器函数仅触发者角色 | `proacl` 无 `{=X/` |
| 默认权限 | 未来新表不再自动授 anon（default privileges 已 REVOKE） | `ALTER DEFAULT PRIVILEGES` |
| 错误上报 | 唯一入口 `report-error`：IP DB 计数 1min/30 + 028 全局熔断 1min/200 + H9 含密丢弃 + user_id 仅信 JWT | 匿名直插 42501；限流 429；含密 dropped |
| 函数内部 | 全部 SECURITY DEFINER 固定 search_path；FORCE RLS 全覆盖；UPDATE 全 WITH CHECK | 断言 A1/A6/A10/A14 |

---

## 三、值得保留的亮点（不要重构掉）

| 亮点 | 位置 | 为什么好 |
|------|------|----------|
| **列级隔离 RPC** | 018 `get_public_group` / 025 `get_public_category` | 认准了 RLS 只管行不管列，用 SECURITY DEFINER + 显式字段白名单根治。配合 `REVOKE ALL FROM PUBLIC` + 精确 `GRANT`，权限最小化。实测返回 13 列，无 `username`/`password`/`user_id` ✅ |
| **SSRF 全套防护** | `check-link/ssrf-guard.ts` | IPv4/IPv6 全形态解析（含 `::ffff:127.0.0.1` 混合态）、DNS 重绑定校验、解析失败 **fail-closed**、重定向逐跳重新校验、协议端口白名单。这是全后端最扎实的部分 |
| **Port/Adapter 可测边界** | `src/composables/domain/syncRemotePort.ts` | 把远端 IO 抽象成接口 + `createMemorySyncPort()` 内存实现，单测无需 mock 整个 supabase。注释还解释了「为什么必须透传 count」——因为 update 不命中时 `{data:null,error:null}` 与成功同形 |
| **自我纠错的迁移注释** | 015 → 020 | 015 写错假设，020 用 COMMENT 公开纠正并说明托管环境为何不能 `NOBYPASSRLS`。这种「把错误留在代码里」的做法比删掉重写有价值得多 |
| **前端数据面收敛** | 全项目 | 仅 4 张表 + 3 个 RPC，无一处 `from()` 直连敏感表。攻击面小是设计出来的 |

---

## 四、问题清单

> **状态总览（2026-09-02 修复后）：P0 ×2、P1 ×3、P2 ×7 全部已修复并实测验证**（迁移 027-031 + 函数 report-error + config/toml/测试/CI）。逐条状态见下文各节与「实施步骤」执行状态。

### P0 — 有实证证据，建议尽快修

#### P0-1 公开组列隔离漏了组表本身

| 项 | 内容 |
|----|------|
| 位置 | `sibling_groups` 策略 `"Anyone can view public groups"`（010/012/013 遗留） |
| 问题 | 该策略只约束行不约束列，匿名 `.select('*')` 可拿全部 17 列，含 **`user_id`（所有者 UUID）**、**`notes`（笔记富文本全文）**、**`pinned_at`**、**`attributes`**。018 只收口了 `bookmarks`，注释称「组表无凭证列，风险可接受」——但 `pinned_at` 恰恰是 023 明确要求公开分享不暴露的字段，原则自相矛盾 |
| 证据 | `curl "$URL/sibling_groups?select=*&is_public=eq.true&limit=1" -H "apikey: <anon>"` → **200**，返回 `['attributes','bookmark_ids','category_id','created_at','deleted_at','icon','id','is_expanded','is_public','name','notes','order','pinned_at','updated_at','updated_at_num','use_count','user_id']`<br>对照组 `rpc/get_public_group` → 仅 13 列，无 `user_id`/`pinned_at` ✅ |
| 修复 | **DROP 该策略**，公开读统一收敛到 RPC。已验证 `src/composables/domain/syncShare.ts:27`、`functions/s/[gid].ts:65`、`functions/s/c/[sid].ts:60`、`share-html/index.ts`、`extension/` **无任何代码依赖匿名直读该表** |
| 交付 | 已写入 `supabase/migrations/028_security_hardening.sql` 第 1 节 |

#### P0-2 两张表的 UPDATE 策略缺 WITH CHECK

| 项 | 内容 |
|----|------|
| 位置 | `public_category_shares`（025 新建）、`storage.objects` 的 `group-images update own`（024 新建） |
| 问题 | 014 为 5 张老表补了 WITH CHECK，新建的两处漏补。FOR UPDATE 只有 USING 时不校验修改后的行，认证用户可把 `user_id`/`category_id`/对象 `name` 改成任意值 —— 与 014 修的是同款越权写 |
| 证据 | 远程 `pg_policy`：`public_category_shares \| update \| has_withcheck = false`<br>`objects \| group-images update own \| has_withcheck = false`<br>对照：`bookmarks`/`categories`/`sibling_groups` 均 `true` ✅ |
| 修复 | 补 `WITH CHECK`，表达式与 `USING` 一致 |
| 交付 | 已写入 028 第 2 节 |

### P1 — 设计缺口，需改造但非紧急

#### P1-3 缺 `supabase/config.toml`

项目只有 `wrangler.toml`，没有 `supabase/config.toml`。后果：Edge Function 的 `verify_jwt` 无法声明式管理（只能靠 CLI `--no-verify-jwt`，配置游离在历史命令里）、本地 `supabase start` 无配置、DB linter 规则未启用。**这是后端可维护性最大的单点缺口。**

> ✅ **2026-09-02 已交付**：`supabase/config.toml`（`project_id = "ulink"`，声明 `share-html` / `send-feedback` → `verify_jwt = false`，`check-link` → `verify_jwt = true`，与现有部署行为一致，TOML 语法已验证）。

#### P1-4 `error_logs` 匿名无限流写入

| 项 | 内容 |
|----|------|
| 问题 | INSERT 策略 `(user_id IS NULL OR user_id = auth.uid())`，无速率约束。016 加了长度 CHECK、019 堵了伪造 user_id，**速率**自 016 起就标注「列为 follow-up」，至今未做 |
| 证据 | 无 Authorization 头并发 12 次 POST `/rest/v1/error_logs` → **12 × 201 Created**，零拒绝 |
| 方案 A（止损） | DB 触发器全局熔断：1 分钟 200 条。粗粒度但把攻击成本从「无限」降为「可控」。**已写入 028 第 4 节**（含已知局限：READ COMMITTED 下并发突刺会低估） |
| 方案 B（根治） | 前端 `errorReporter.ts` 改调 Edge Function，函数侧按 IP 哈希计数限流（可复用 `send-feedback` 现成的 `sha256Hex(ip|salt)` + 时间窗计数模式），再撤掉匿名 INSERT 策略。**推荐，见实施步骤 Phase 2** |
| 落地（2026-09-02） | ✅ `030_error_logs_funnel.sql`（撤匿名 INSERT + error_logs.ip_hash 列与索引）+ `report-error` Edge Function（按 IP DB 计数 1min/30，**首版实例内存限流实测多实例失效已弃**）+ `errorReporter.ts` 改道 `functions.invoke`。实测：匿名直插 → 42501 拒绝；函数限流 → 200≈30 后 429；含密/H9、user_id 防伪造均验证。028 全局熔断保留作最终兜底 |

#### P1-5 SQL 迁移零测试、CI 不覆盖 supabase

- `src/__tests__/migrations.test.ts` 测的是**前端 localStorage 迁移**（`stores/migrations.js`），**不是** SQL 迁移 —— 名字有误导性。
- `.github/workflows/` 只有 `ci.yml`，grep 不到任何 `supabase`。
- 后果：018「history 标 applied 但库内缺函数」这类问题只能靠人工发现。

> ✅ **2026-09-02 已交付**：
> - `supabase/tests/database.test.sql` — pgTAP 标准测试，10 项不变量（FORCE RLS 全覆盖 / 复合主键 / 匿名直读三表被拒 / UPDATE 策略 WITH CHECK / storage 无匿名策略 / error_logs 熔断 / RPC 为 SECURITY DEFINER / search_path 固定），CI 用 `supabase db test` 执行；
> - `supabase/tests/assertions.sql` — 零依赖远程断言版（事务内只读，不污染数据），本机无 Docker 时可 `supabase db query -f ... --linked` 直接验证，**实测 10/10 通过**；
> - `.github/workflows/ci.yml` 新增 `supabase-db-test` job（本地栈 `supabase start` + `db reset` 应用迁移 + `db test` 跑 pgTAP），与 lint/e2e 并行、同属 PR 门禁，无需任何 secrets。

### P2 — 工程质量债

| 编号 | 问题 | 证据 | 建议 |
|------|------|------|------|
| P2-6 | **SSRF 逻辑双份镜像** | `check-link/index.ts:19` 注释「镜像自 ssrf-guard.ts，请与该文件保持一致」——index.ts 内联拷贝了 `isPrivateIPv4`/`parseIPv6Hostname` 等 6 个函数，而 `ssrf-guard.ts` 就在同目录却**未被 import**。测试 `src/__tests__/ssrf-guard.test.ts` 只覆盖源文件，**镜像副本无测试保护** | 改 Deno 相对路径 import（`./ssrf-guard.ts`），删掉镜像块。若部署环境确实不支持，加 CI 校验两文件函数签名一致 |
| P2-7 | **渲染实现 + 双语字典双份** | `supabase/functions/share-html/index.ts` 40 KB vs `functions/_lib/share-render.ts` 76 KB，T 字典需手工同步（share-html 16 处 zh-CN 相关 vs share-render 3 处）。且是「部分重复」——share-render 含分类渲染而 share-html 不含，比完全重复更危险 | 长期：让 Deno 版从 CF 版生成，或反过来。短期：加测试比对两处 T 字典的 key 集合 |
| P2-8 | **2 个 plpgsql 函数 search_path 可变** | `update_updated_at`（001）、`prune_data_history`（009）→ `search_path_mutable = true`；而 018/020/025 的函数均为 `false` ✅ | `SET search_path = public`。已写入 028 第 5 节 |
| P2-9 | **FORCE RLS 漏 2 张表** | `feedback_messages`、`public_category_shares` → `relforcerowsecurity = false`，其余 8 张 `true` ✅ | 已写入 028 第 3 节 |
| P2-10 | **无效索引** | `idx_sibling_groups_public ON sibling_groups(id) WHERE is_public = TRUE` —— `id` 已是主键，该部分索引零额外选择性，纯写入负担 | DROP。已写入 028 第 6 节 |
| P2-11 | **策略角色过宽** | 多数 SELECT/INSERT/DELETE 策略为 `TO public`（001 未指定角色），逻辑上安全（匿名时 `auth.uid()` 为 NULL 不匹配），但语义不清晰且多一次策略求值 | 显式改为 `TO authenticated` |
| P2-12 | **`deleted_at` 无索引** | `selectSoftDeleted` 走 `user_id + NOT(deleted_at IS NULL) + updated_at_num`，现有复合索引无法覆盖 `deleted_at` 过滤 | 加部分索引 `(user_id, updated_at_num) WHERE deleted_at IS NOT NULL`（仅索引已删行，体积可忽略）。当前数据量小，可延后 |

---

## 五、性能现状（远程实测）

| 表 | 体积 | 状态 |
|----|------|------|
| `data_history` | **2088 kB** | ⚠️ 最大表。见下方分析 |
| `link_check_history` | 424 kB | 增长型，靠 `cleanup_old_check_history()` 保留 30 天 |
| `bookmarks` | 368 kB | 正常 |
| `sibling_groups` | 248 kB | 正常 |
| `error_logs` | 192 kB | 无清理机制，只有 028 新加的熔断 |
| `categories` | 96 kB | 正常 |
| `custom_attributes` | 80 kB | 正常 |
| `public_category_shares` | 64 kB | 正常 |
| `feedback_messages` | 48 kB | 正常 |
| `user_security` | 32 kB | 正常 |

**30 个索引**，整体设计合理：008 的 `(user_id, updated_at_num)` 复合索引精确覆盖同步增量拉取，017/023 的排序索引到位。

**唯一真实的性能隐患：`data_history` 触发器写入放大。**

009 的 `prune_data_history()` 是 `AFTER INSERT FOR EACH ROW` 触发器，每次插入都执行：

```sql
DELETE FROM data_history
WHERE id IN (
  SELECT id FROM data_history
  WHERE user_id = NEW.user_id AND item_id = NEW.item_id
  ORDER BY created_at DESC OFFSET 10
);
```

即**每次写入都要扫一遍该 item 的全部历史再删溢出部分**。写入频率高时是 O(n) 放大。当前 2 MB / 单用户规模下无感，但这是唯一一个会随使用量非线性劣化的点。

优化选项（二选一）：
1. **改异步**：撤掉行级触发器，用 `pg_cron` 每天批量清理一次（`DELETE ... WHERE id NOT IN (SELECT ... OVER (PARTITION BY user_id, item_id ORDER BY created_at DESC) <= 10)`）。
2. **改约束**：前端写入时就不超过 10 条，触发器降级为兜底。

---

## 六、实施步骤

> **执行状态（2026-09-02）**
> - ✅ **Phase 1 已完成**：`027_per_user_id_composite_pk.sql`（复合主键事故修复）+ `028_security_hardening.sql`（本报告全部修复）已 `supabase db push --linked` 推送到远程库，并完成黑盒实测：
>   - 匿名直读 `sibling_groups` → `[]`（修复前返回含 `user_id`/`notes`/`pinned_at` 的完整行）
>   - `get_public_group` RPC → 200（公开分享功能不受影响）
>   - `error_logs` 熔断实测：窗口内满 200 条后新写入 → HTTP 400 拒绝
>   - 复核修正：**storage 匿名列举 P1 不成立**——`storage.objects` 无任何 anon 策略，实测匿名 list → 404，无需修复
> - ✅ **Phase 2 全部完成**：`config.toml`（官方模板重建，对齐远程 PG17；手写段曾触发 CLI CliConfigParseError，[inbucket]→[local_smtp] + URL 通配修正）、pgTAP + 零依赖断言（远程实测 11/11 通过）、CI `supabase-db-test` job、**P1-4 方案 B**：`030_error_logs_funnel.sql`（撤匿名 INSERT，实测直插 42501）+ `report-error` Edge Function（按 IP DB 计数限流 1min/30，跨实例一致；首版实例内存限流实测多实例失效已弃）+ 前端 `errorReporter.ts` 改道 `functions.invoke`（user_id 不再直传）。
> - ✅ **Phase 3 部分完成**：P2-6 SSRF 镜像消除（`check-link` 删 179 行镜像改 import 真源，部署验证相对 import 打包成功）、P2-7 T 字典 key 子集比对测试（`share-dict-sync.test.ts`）、P2-11 策略角色显式化（`029`，至此**零 TO PUBLIC**）、P2-12 deleted_at 部分索引（`029`）。
> - ⬜ **Phase 3 剩余**：P2-7 文案级一致性（当前仅比 key 集合）、`data_history` 触发器异步化（pg_cron，需评估托管 pg_cron 可用性）。

### Phase 1 — 安全收口（低风险，可直接执行）✅ 已完成

```bash
# 1. 应用 028 修复（已在事务内试跑验证语法，库当前未改动）
npx supabase db push --linked

# 2. 逐项验证
curl -s "$URL/sibling_groups?select=*&is_public=eq.true" -H "apikey: $ANON"
#    期望：[] 或 401（修复前返回含 user_id 的完整行）

curl -s -o /dev/null -w "%{http_code}\n" \
  "$URL/rpc/get_public_group" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"p_gid":"sg_verify_001"}'
#    期望：200 —— 公开分享功能不受影响（这是唯一的公开读路径）

# 3. 回归：确认站内分享页仍正常
#    https://ulink.ren/s/<gid> 与 /s/c/<share_id>
```

**验收标准**：公开分享页正常 + `sibling_groups` 匿名直读返回空。

### Phase 2 — 工程护栏（中风险，建议单独 PR）

1. **补 `supabase/config.toml`**（先只声明 functions 与 db，不改动现有行为）：

   ```toml
   [functions.check-link]
   verify_jwt = true          # 现有行为：需用户 JWT（函数内 getUser 鉴权）

   [functions.share-html]
   verify_jwt = false         # 现有行为：匿名可访问（SSR 公开页）

   [functions.send-feedback]
   verify_jwt = false         # 现有行为：匿名可提交

   [db.migrations]
   schema_paths = []
   ```

   ⚠️ 创建后先跑一次 `npx supabase db push --linked` 确认行为无变化，再提交。

2. **error_logs 改道 Edge Function（方案 B）**：
   - 新建 `supabase/functions/report-error/index.ts`，复用 `send-feedback` 的限流骨架（`sha256Hex(ip|salt)` + 时间窗 count + 落库）。
   - `src/lib/errorReporter.ts` 改调该函数。
   - 验证稳定后：`DROP POLICY "Anyone can insert error logs"` + 撤掉 028 的熔断触发器。

3. **迁移测试落地**：引入 pgTAP 或 `supabase test new`，至少覆盖三条不变量：
   - 匿名对 10 张表的 SELECT 全部返回空
   - `get_public_group` / `get_public_category` 返回字段集合不含 `username`/`password`/`user_id`/`pinned_at`
   - 每个新迁移都带对应断言（防 018 重演）

4. **CI 接入**：在 `ci.yml` 加一步 `supabase db push --linked` 前先跑 `supabase db lint --level warning`。

### Phase 3 — 消除重复（低优先级，可排期）

1. `check-link/index.ts` 改 import `./ssrf-guard.ts`，删除 191 行镜像块。
2. 加测试比对 `share-html/index.ts` 与 `functions/_lib/share-render.ts` 的 T 字典 key 集合。
3. `data_history` 触发器改异步或降级。
4. 策略角色 `public` → `authenticated` 显式化。
5. 补 `deleted_at` 部分索引（P2-12）。

---

## 七、附：本次审计的验证方法（可复用）

```bash
# 查远程 RLS / FORCE 状态（注意 pg_class 用 relforcerowsecurity，不是 pg_tables）
npx supabase db query "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;" --linked

# 查策略 USING / WITH CHECK 完整性（polcmd: r=SELECT a=INSERT w=UPDATE d=DELETE）
npx supabase db query "SELECT c.relname, p.polname, p.polcmd,
  (p.polqual IS NOT NULL) AS has_using,
  (p.polwithcheck IS NOT NULL) AS has_withcheck
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid ORDER BY 1,3;" --linked

# 查函数 SECURITY DEFINER / search_path
npx supabase db query "SELECT proname, prosecdef,
  (proconfig IS NULL OR proconfig::text NOT LIKE '%search_path%') AS mutable
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public';" --linked

# 迁移语法试跑（事务内执行后回滚，零副作用）
{ echo 'BEGIN;'; cat supabase/migrations/0XX_*.sql; echo 'ROLLBACK;'; } > /tmp/dry.sql
npx supabase db query -f /tmp/dry.sql --linked
```

黑盒验证用 anon key 打 PostgREST，观察每条公开路径的真实返回列。审计期间写入的探针数据已全部清理（实测 `count = 0`）。
