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
--
-- 运行方式（需要 Docker 起本地栈，官方镜像自带 pgTAP）：
--   supabase start && supabase db reset && supabase db test
--   （CI 见 .github/workflows/ci.yml 的 supabase-db-test job）
--
-- 无 Docker 环境的替代：supabase/tests/assertions.sql（零依赖，可对远程库直跑）

BEGIN;

SELECT plan(14);

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

SELECT * FROM finish();
ROLLBACK;
