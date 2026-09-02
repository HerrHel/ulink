-- 027_per_user_id_composite_pk.sql
-- 同步表主键 id → (user_id, id)：修复跨用户 id 冲突导致的 RLS 推送失败。
--
-- 背景（线上事故）：
--   新账户首次登录后 initialSync 全量推送报
--     new row violates row-level security policy (USING expression) for table "bookmarks"
--   15 项全部失败，本地数据始终无法上云。
--
-- 根因：
--   1) 首装种子数据（src/config/constants.ts buildSeedDefaults）用的是**全局固定 id**：
--      bookmarks  = b1 b2 b3 sb1 sb2 b4 b5            (7)
--      categories = all uncategorized email tools ai social game (7，其中虚拟分类 2 项不推送)
--      attributes = requires-login ai is-group        (3)
--      → 7 + 5 + 3 = 15，与线上失败项数完全吻合。
--   2) 而 4 张同步表的主键是单列 `id TEXT PRIMARY KEY` —— **全局唯一，而非 per-user 唯一**。
--   3) upsert 走 `onConflict: 'id'`：一旦某个 id 已被**其他用户**占用，Postgres 不再走
--      INSERT，而是 ON CONFLICT DO UPDATE，触发 UPDATE 策略的 USING 子句
--      `auth.uid() = user_id` —— 行属于别人，USING 为假 → 抛 RLS 违反。
--      这正是错误信息里 "(USING expression)" 的由来（INSERT 违反的是 WITH CHECK，
--      UPDATE/DELETE 才走 USING）。
--   结论：第一个把种子数据推上云的用户，会把这 17 个固定 id 全部占坑，此后**每一个**
--   新账户的全量推送都必然失败。
--
-- 修复：
--   把主键改为 (user_id, id) 复合主键，语义回到「数据归属于用户」：同一 id 在不同
--   用户下各占一行，互不干扰；同一用户内的 upsert 仍按 id 幂等覆盖。
--   代码侧配套：syncRemotePort.upsert **不再写死 onConflict**，让 PostgREST 以
--   「表当前主键」为冲突目标——迁移前 (id)、迁移后 (user_id, id) 两阶段都正确，
--   消除 DDL 与前端资源无法原子切换的部署顺序陷阱（row 含 id 与 user_id 全主键列）。
--
-- 影响面评估（改前实测）：
--   - 全库无任何外键引用这 4 张表的 id（唯一外键均为 user_id → auth.users），
--     故改主键无级联风险，不需要重建任何引用。
--   - 数据量极小：bookmarks 162 行 / categories 10 / sibling_groups 11 /
--     custom_attributes 7，迁移为秒级。
--   - 公开分享 RPC（get_public_group / get_public_category）内部查询均带 user_id
--     等值条件，复合主键前导列即为 user_id，命中不变；sibling_groups 另有
--     idx_sibling_groups_public (id) WHERE is_public 部分索引兜住按 id 的公开查询。
--
-- 执行：supabase db push --linked

BEGIN;

-- ── bookmarks ──
ALTER TABLE public.bookmarks DROP CONSTRAINT IF EXISTS bookmarks_pkey;
ALTER TABLE public.bookmarks ADD PRIMARY KEY (user_id, id);
-- 保留 id 单列索引：主键前导列变成 user_id 后，`WHERE id = ?`（不带 user_id）的
-- 查询会失去索引支撑。公开分享 RPC、后台排查、按 id 定向修复都会用到。
CREATE INDEX IF NOT EXISTS idx_bookmarks_id ON public.bookmarks (id);

-- ── categories ──
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE public.categories ADD PRIMARY KEY (user_id, id);
CREATE INDEX IF NOT EXISTS idx_categories_id ON public.categories (id);

-- ── sibling_groups ──
ALTER TABLE public.sibling_groups DROP CONSTRAINT IF EXISTS sibling_groups_pkey;
ALTER TABLE public.sibling_groups ADD PRIMARY KEY (user_id, id);
CREATE INDEX IF NOT EXISTS idx_sibling_groups_id ON public.sibling_groups (id);

-- ── custom_attributes ──
ALTER TABLE public.custom_attributes DROP CONSTRAINT IF EXISTS custom_attributes_pkey;
ALTER TABLE public.custom_attributes ADD PRIMARY KEY (user_id, id);
CREATE INDEX IF NOT EXISTS idx_custom_attributes_id ON public.custom_attributes (id);

COMMIT;

-- PostgREST 缓存了表的主键/唯一约束元数据，用于解析 upsert 的 onConflict 参数。
-- 不刷新则 onConflict='user_id,id' 会报「没有匹配唯一约束」，必须显式 reload。
NOTIFY pgrst, 'reload schema';
