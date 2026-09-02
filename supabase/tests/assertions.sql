-- supabase/tests/assertions.sql
-- 后端关键不变量自包含断言（零依赖，无需 pgTAP 扩展）
--
-- 用途：无 Docker 环境的验证（本机 / 远程库直接跑）。
--   supabase db query -f supabase/tests/assertions.sql --linked
-- 或：psql "$DATABASE_URL" -f supabase/tests/assertions.sql
--
-- 事务内执行（BEGIN…ROLLBACK），只读断言，不污染任何数据。
-- 全部通过 → RAISE NOTICE 'ALL N ASSERTIONS PASSED'；
-- 任一失败 → RAISE EXCEPTION 'ASSERT FAIL: <id,id,…>'（非零退出码）。
--
-- 与 supabase/tests/database.test.sql（pgTAP，CI 用）断言一一对应。

BEGIN;

CREATE TEMP TABLE _t_assert (
  id     text PRIMARY KEY,
  passed boolean,
  note   text
);

-- SET ROLE anon 后断言仍需写结果表，先授权（temp 表权限是会话级的）
GRANT ALL ON _t_assert TO anon;

-- ── 1. FORCE RLS：public 下所有用户表必须开启 ──
INSERT INTO _t_assert
SELECT 'A1',
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT c.relforcerowsecurity) = 0,
  'public 全部用户表开启 FORCE ROW LEVEL SECURITY';

-- ── 2. 同步表复合主键 (user_id, id) ──
INSERT INTO _t_assert
SELECT 'A2',
  (SELECT count(DISTINCT c.relname) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
    WHERE i.indisprimary
      AND c.relname IN ('bookmarks','categories','sibling_groups','custom_attributes')
      AND i.indnkeyatts = 2) = 4,
  '4 张同步表主键为复合主键 (user_id, id)';

-- ── 3. 匿名直读 sibling_groups 被拒 ──
SET ROLE anon;
INSERT INTO _t_assert
SELECT 'A3', (SELECT count(*) FROM sibling_groups) = 0,
  '匿名无法直读 sibling_groups（028 撤除公开 SELECT 策略）';
RESET ROLE;

-- ── 4. 匿名直读 bookmarks 被拒 ──
SET ROLE anon;
INSERT INTO _t_assert
SELECT 'A4', (SELECT count(*) FROM bookmarks) = 0,
  '匿名无法直读 bookmarks';
RESET ROLE;

-- ── 5. 匿名直读 public_category_shares 被拒 ──
SET ROLE anon;
INSERT INTO _t_assert
SELECT 'A5', (SELECT count(*) FROM public_category_shares) = 0,
  '匿名无法直读 public_category_shares';
RESET ROLE;

-- ── 6. 所有 UPDATE 策略必须带 WITH CHECK ──
INSERT INTO _t_assert
SELECT 'A6',
  (SELECT count(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polcmd = 'w' AND p.polwithcheck IS NULL) = 0,
  '全部 UPDATE 策略带 WITH CHECK';

-- ── 7. storage.objects 无匿名策略 ──
INSERT INTO _t_assert
SELECT 'A7',
  (SELECT count(*) FROM pg_policy p
     JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname = 'objects' AND p.polroles::text LIKE '%anon%') = 0,
  'storage.objects 无匿名策略';

-- ── 8. error_logs 写入熔断触发器存在 ──
INSERT INTO _t_assert
SELECT 'A8',
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_error_logs_throttle'),
  'error_logs 存在写入熔断触发器';

-- ── 9. 公开读 RPC 为 SECURITY DEFINER ──
INSERT INTO _t_assert
SELECT 'A9',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_public_group','get_public_category')
      AND p.prosecdef) = 2,
  'get_public_group / get_public_category 均为 SECURITY DEFINER';

-- ── 10. 所有 SECURITY DEFINER 函数固定 search_path ──
INSERT INTO _t_assert
SELECT 'A10',
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND (p.proconfig IS NULL OR NOT p.proconfig::text LIKE '%search_path%')) = 0,
  '全部 SECURITY DEFINER 函数固定 search_path';

-- ── 汇总 ──
DO $$
DECLARE
  v_failed_cnt integer;
  v_failed     text;
  v_total      integer;
BEGIN
  v_total      := (SELECT count(*) FROM _t_assert);
  v_failed_cnt := (SELECT count(*) FROM _t_assert WHERE NOT passed);
  v_failed     := (SELECT string_agg(id, ', ' ORDER BY id) FROM _t_assert WHERE NOT passed);

  IF v_failed_cnt > 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL (%/%), failed: %', v_failed_cnt, v_total, v_failed;
  END IF;

  RAISE NOTICE 'ALL % ASSERTIONS PASSED ✅', v_total;
END $$;

-- 可视汇总（RAISE NOTICE 在 db query -f 下可能不显示，此处直接出表）
SELECT count(*) AS total,
       count(*) FILTER (WHERE passed) AS passed,
       string_agg(id, ', ' ORDER BY id) FILTER (WHERE NOT passed) AS failed
FROM _t_assert;

ROLLBACK;
