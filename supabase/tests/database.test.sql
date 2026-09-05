-- supabase/tests/database.test.sql
-- 后端关键不变量测试（pgTAP）
--
-- 覆盖 docs/BACKEND_AUDIT.md 第二阶段要求的「串联机制」：
--   1. FORCE RLS 全覆盖（防 015 之后新建表漏 FORCE）
--   2. 同步表复合主键 (user_id, id)（防 027 事故回归）
--   3. 匿名直读公开数据被 RLS 拦截（防 018/028 列泄露回归）
--   4. UPDATE 策略 WITH CHECK 全覆盖（防 014 之后新策略漏 WITH CHECK）
--   5. storage.objects 无匿名策略（防 storage 列举泄露）
--   6. error_logs 写入熔断存在（防无限写入）
--   7. SECURITY DEFINER RPC 存在且固定 search_path（防 search_path 注入）
--   8. 032 删除防线：复活守卫触发器 + 墓园表不可变 + 行为级拦截（旧快照复活 /
--      墓园存活重插被拦；正规恢复 / 墓碑重插放行）
--
-- 运行方式（需要 Docker 起本地栈，官方镜像自带 pgTAP）：
--   supabase start && supabase db reset && supabase db test
--   （CI 见 .github/workflows/ci.yml 的 supabase-db-test job）
--
-- 无 Docker 环境的替代：supabase/tests/assertions.sql（零依赖，可对远程库直跑；
-- 行为级断言因需写 auth.users 夹具仅在本文件覆盖）

BEGIN;

SELECT plan(23);

-- ── 1. FORCE RLS：public 下所有用户表必须开启 ──
-- 015 只覆盖当时 8 张表；024/025 新增表在 028 才补齐。此处断言"一张都不能漏"。
SELECT is(
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT c.relforcerowsecurity),
  0,
  'public 全部用户表开启 FORCE ROW LEVEL SECURITY'
);

-- ── 2. 同步表复合主键 (user_id, id) ──
-- 027 修复：单列 id 主键导致跨用户 upsert 冲突（RLS USING 违反）。
-- 断言 4 张同步表主键均为 2 列。
SELECT is(
  (SELECT count(DISTINCT c.relname) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
    WHERE i.indisprimary
      AND c.relname IN ('bookmarks','categories','sibling_groups','custom_attributes')
      AND i.indnkeyatts = 2),
  4,
  '4 张同步表主键为复合主键 (user_id, id)'
);

-- ── 3. 匿名直读 sibling_groups 被拒（SEC-02 核心不变量）──
-- 028 撤策略 + 031 撤 anon GRANT：匿名 SELECT 在 GRANT 层即抛 42501。
SET ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM sibling_groups$$,
  '42501',
  '匿名无法直读 sibling_groups（031 GRANT 层拒绝）'
);
RESET ROLE;

-- ── 4. 匿名直读 bookmarks 被拒 ──
SET ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM bookmarks$$,
  '42501',
  '匿名无法直读 bookmarks（031 GRANT 层拒绝）'
);
RESET ROLE;

-- ── 5. 匿名直读 public_category_shares 被拒 ──
SET ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public_category_shares$$,
  '42501',
  '匿名无法直读 public_category_shares（031 GRANT 层拒绝）'
);
RESET ROLE;

-- ── 6. 所有 UPDATE 策略必须带 WITH CHECK ──
-- 014 补老表、028 补 024/025 新表；断言未来任何新增 UPDATE 策略都不能漏。
SELECT is(
  (SELECT count(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polcmd = 'w' AND p.polwithcheck IS NULL),
  0,
  '全部 UPDATE 策略带 WITH CHECK'
);

-- ── 7. storage.objects 无匿名策略（匿名列举被拒）──
SELECT is(
  (SELECT count(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'objects' AND p.polroles::text LIKE '%anon%'),
  0,
  'storage.objects 无匿名策略'
);

-- ── 8. error_logs 写入熔断触发器存在 ──
SELECT has_trigger('public', 'error_logs', 'trg_error_logs_throttle',
  'error_logs 存在写入熔断触发器 trg_error_logs_throttle');

-- ── 9. 公开读 RPC 为 SECURITY DEFINER ──
-- 公开读唯一合法通道：get_public_group / get_public_category（列白名单）。
SELECT is(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_public_group','get_public_category')
      AND p.prosecdef),
  2,
  'get_public_group / get_public_category 均为 SECURITY DEFINER'
);

-- ── 10. 所有 SECURITY DEFINER 函数固定 search_path ──
-- 001 update_updated_at / 009 prune_data_history 曾在 028 补齐；
-- 断言未来新增 plpgsql 函数都不能忘。
SELECT is(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND (p.proconfig IS NULL OR NOT p.proconfig::text LIKE '%search_path%')),
  0,
  '全部 SECURITY DEFINER 函数固定 search_path'
);

-- ── 11. 策略角色显式化：无任何 TO PUBLIC 策略 ──
-- 029 落地 owner 语义策略全部 TO authenticated；030 撤除 error_logs 匿名 INSERT
-- （唯一写入口 = report-error 函数）——public 表至此零 public 角色策略。
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND roles = '{public}'),
  0,
  'public 表无任何 TO PUBLIC 策略（029+030）'
);

-- ── 12. anon 对 public 表零 GRANT（031 纵深防御）──
SELECT is(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'),
  0,
  'anon 对 public 表零 GRANT（031）'
);

-- ── 13. authenticated 无 TRUNCATE/TRIGGER/REFERENCES（031）──
SELECT is(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated' AND table_schema = 'public'
      AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')),
  0,
  'authenticated 无 TRUNCATE/TRIGGER/REFERENCES（031）'
);

-- ── 14. 触发器函数无 PUBLIC EXECUTE（031）──
SELECT is(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proacl::text LIKE '{=X/%'),
  0,
  'public 函数无 PUBLIC EXECUTE（031）'
);

-- ── 15. 复活守卫触发器存在（032）──
-- 4 张同步表各挂 trg_<table>_resurrect_guard（BEFORE INSERT OR UPDATE）。
SELECT is(
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND t.tgname = 'trg_' || c.relname || '_resurrect_guard'
      AND c.relname IN ('bookmarks','sibling_groups','categories','custom_attributes')),
  4,
  '4 张同步表存在复活守卫触发器（032）'
);

-- ── 16. 墓园记录触发器存在（032）──
SELECT is(
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND t.tgname = 'trg_' || c.relname || '_graveyard'
      AND c.relname IN ('bookmarks','sibling_groups','categories','custom_attributes')),
  4,
  '4 张同步表存在物理删除墓园记录触发器（032）'
);

-- ── 17. 墓园表不可变（032）──
-- 仅 owner SELECT（客户端补推排除）+ 触发器/INSERT 兜底写入；无 UPDATE/DELETE 策略。
SELECT is(
  (SELECT count(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'deleted_item_graveyard'
      AND p.polcmd IN ('u','d')),
  0,
  'deleted_item_graveyard 无 UPDATE/DELETE 策略（墓园不可变）'
);

-- ── 18. 行为级：032 删除防线核心不变量 ──
-- 夹具 auth.users + authenticated JWT 模拟；全部改动随外层 ROLLBACK 丢弃。
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'pgtap-guard@test.local', 'x', NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 18a. 墓碑基线：软删行可写入
INSERT INTO bookmarks (id, user_id, title, updated_at_num, deleted_at)
VALUES ('pgtap-guard-bm', '11111111-1111-1111-1111-111111111111', '删除守卫测试', 1000, NOW());
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM bookmarks WHERE id = 'pgtap-guard-bm'),
  true,
  '软删墓碑可正常写入（18a 基线）'
);

-- 18b. 旧存活快照 UPDATE 复活 → 拦截（updated_at_num 未超过墓碑）
UPDATE bookmarks SET deleted_at = NULL, updated_at_num = 500 WHERE id = 'pgtap-guard-bm';
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM bookmarks WHERE id = 'pgtap-guard-bm'),
  true,
  '旧存活快照无法复活软删墓碑（updated_at_num 未超过墓碑时间）'
);

-- 18c. 正规恢复（updated_at_num 更新）→ 放行
UPDATE bookmarks SET deleted_at = NULL, updated_at_num = 2000 WHERE id = 'pgtap-guard-bm';
SELECT is(
  (SELECT deleted_at IS NULL FROM bookmarks WHERE id = 'pgtap-guard-bm'),
  true,
  'updated_at_num 更新的正规恢复放行（回收站恢复语义不受限）'
);

-- 18d. 物理 DELETE → 墓园记录
DELETE FROM bookmarks WHERE id = 'pgtap-guard-bm';
SELECT is(
  (SELECT count(*) FROM deleted_item_graveyard
    WHERE item_id = 'pgtap-guard-bm' AND table_name = 'bookmarks'),
  1,
  '物理 DELETE 写入墓园（彻底删除在其他端不可被补推复活）'
);

-- 18e. 墓园条目以存活态重新 INSERT → 拦截
INSERT INTO bookmarks (id, user_id, title, updated_at_num)
VALUES ('pgtap-guard-bm', '11111111-1111-1111-1111-111111111111', 'x', 3000);
SELECT is(
  (SELECT count(*) FROM bookmarks WHERE id = 'pgtap-guard-bm'),
  0,
  '墓园条目无法以存活态重新 INSERT'
);

-- 18f. 墓园条目以墓碑态重新 INSERT → 放行（跨端删除状态再传播）
INSERT INTO bookmarks (id, user_id, title, updated_at_num, deleted_at)
VALUES ('pgtap-guard-bm', '11111111-1111-1111-1111-111111111111', 'x', 3000, NOW());
SELECT is(
  (SELECT deleted_at IS NOT NULL FROM bookmarks WHERE id = 'pgtap-guard-bm'),
  true,
  '墓碑态重插放行（删除状态可跨端再传播）'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
