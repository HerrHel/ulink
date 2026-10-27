# `supabase/` — 历史归档目录

> **状态：归档。生产后端已于 2026-10-22 全量切换到腾讯云 CloudBase，本目录不再是生产代码。**
> **不要再往这里加任何新功能。** 新增后端逻辑一律写到 `cloudbase/functions/` 与
> `cloudbase/migrations/`。

## 目录里各部分的作用

| 路径 | 是什么 | 现在还用吗 |
|---|---|---|
| `migrations/` | 39 个 PostgreSQL 迁移 SQL（Supabase 时代） | **仅作历史记录**。`scripts/transform-migrations.mjs` 与 `src/__tests__/composables/syncResurrectGuard.test.ts` 会读它 |
| `functions/` | 旧 Edge Functions（check-link / share-html / send-feedback / report-error / extract-video） | 已被 `cloudbase/functions/` 下的同名云函数取代 |
| `tests/database.test.sql` | pgTAP 不变量断言（曾防「history applied ≠ 实际 schema」型事故） | **不再被 CI 执行**（原 `supabase-db-test` job 已于 2026-10-27 移除，见 `.github/workflows/ci.yml` 注释） |
| `email-templates/` | 旧邮件模板 | 已被 `cloudbase/` 下的腾讯云 exmail 模板取代（`scripts/apply-cloudbase-email-templates.mjs`） |
| `verify/` | 历史校验脚本 | 归档 |
| `config.toml` | Supabase 本地栈配置 | 归档（本地栈已不再启动） |

## 为什么不能直接删掉这个目录

三处仍在引用它，删了会破坏现有功能与测试：

1. `src/lib/supabase.ts` —— **双后端兼容层**。生产走 CloudBase，但该 shim 仍保留
   Supabase 分支，`@supabase/supabase-js` 依赖也因此不能从 `package.json` 移除。
   （`src/lib/cloudbase-sdk.js` 走 CloudBase，`src/lib/supabase.js` 走 Supabase，
   扩展与部分测试仍用到后者。）
2. `scripts/transform-migrations.mjs` —— 读取 `migrations/` 做转换。
3. `src/__tests__/composables/syncResurrectGuard.test.ts` —— 读 `migrations/` 做断言。

## CloudBase 侧的对应物

- 生产环境：`ulink-d1g5srvjo54b1886a`（ap-shanghai，个人版），PG `postgres-2m9745ae`
- 迁移文件：`cloudbase/migrations/`
- 云函数：`cloudbase/functions/`
- 查库：`bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --json --sql "SELECT ..."`
- 完整操作手册：`docs/CLOUDBASE_MIGRATION.md`

## 一条历史记录

`docs/BACKEND_AUDIT.md` 里记述了当年 Supabase 时代的加固过程（含 `supabase-db-test`
这道门禁的由来）。那是**当时的快照**，正文保持原样不改；只在该文件顶部标注了
「该门禁已随 CloudBase 迁移移除」的状态，避免后来者按旧结论排查。
