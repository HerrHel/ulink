-- 027_security_hardening.sql
-- 后端安全审计修复：公开组列隔离收口 + WITH CHECK 补齐 + 匿名写入熔断。
--
-- 审计时间：2026-09-02（基于远程库 yqouglfopbmujkqmjgpu 实测）
-- 执行：supabase db push --linked
--
-- 本迁移 4 项修复，均可独立回滚（见每节注释）。
-- ⚠️ 文件名版本：本文件原编号 027，因 027_per_user_id_composite_pk.sql（事故修复）
--    占用编号，现以 028 推送（2026-09-02 已 push 并实测验证，文件头注释保留原编号）。

-- ═══════════════════════════════════════════════════════════════════
-- 1. SEC-02 公开组列隔离收口（sibling_groups 匿名 SELECT）
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：010/012/013 遗留的 sibling_groups 匿名 SELECT 策略
--       "Anyone can view public groups" 只约束「哪些行可读」，不约束「哪些列可读」。
--       匿名访客 .select('*') 可拿到全部 17 列，含：
--         - user_id      所有者 UUID（跨表关联 / 用户画像拼图）
--         - notes        组笔记富文本全文（用户在笔记里写什么都公开）
--         - pinned_at    置顶态（018/023 明确要求公开分享不暴露）
--         - attributes   自定义属性
--       018 只收口了 bookmarks（注释称「组表无凭证列，风险可接受」），漏了组表本身，
--       与「列级隔离」原则自相矛盾。
--
-- 实测证据（anon key 直打 PostgREST）：
--   curl "$URL/sibling_groups?select=*&is_public=eq.true&limit=1" -H "apikey: <anon>"
--   → 200，返回含 user_id / notes / pinned_at 的完整行
--   对照组 rpc/get_public_group → 仅 13 列，无 user_id / pinned_at ✅
--
-- 修复：DROP 该策略。公开读统一收敛到 SECURITY DEFINER RPC
--       （get_public_group / get_public_category），二者已显式白名单列。
--
-- 前置验证（2026-09-02 已确认，执行前请复核）：
--   src/composables/domain/syncShare.ts:27   仅 setGroupPublic 的 owner UPDATE
--   functions/s/[gid].ts:65                  走 rpc/get_public_group
--   functions/s/c/[sid].ts:60                走 rpc/get_public_category
--   supabase/functions/share-html/index.ts   走 rpc('get_public_group')
--   extension/                               无 sibling_groups 引用
--   ⇒ 无任何代码依赖匿名直读 sibling_groups
--
-- 回滚：重建策略即可（CREATE POLICY "Anyone can view public groups" ON sibling_groups
--       FOR SELECT USING (is_public = true AND deleted_at IS NULL);）

DROP POLICY IF EXISTS "Anyone can view public groups" ON sibling_groups;

COMMENT ON TABLE sibling_groups IS
  'SEC-02（027）：匿名直读策略已撤除，公开读仅经 RPC get_public_group / '
  'get_public_category（列白名单，不含 user_id / pinned_at）。同 018 的列隔离原则。';


-- ═══════════════════════════════════════════════════════════════════
-- 2. WITH CHECK 补齐（public_category_shares / storage.objects）
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：014 为 5 张老表补了 UPDATE 的 WITH CHECK，但 024/025 新建的策略漏补。
--       FOR UPDATE 仅有 USING 时只校验「修改前的行」，不校验「修改后的行」：
--         - public_category_shares：认证用户可把某条分享记录的 user_id / category_id
--           改成任意值（UNIQUE 约束只在冲突时拦截），凭空给他人造分享记录。
--         - storage.objects：可把已上传对象的 name 改成他人 userId 目录路径，
--           跨目录污染。
--       这正是 014 描述的同款越权写漏洞。
--
-- 实测证据（远程 pg_policy）：
--   public_category_shares | Users can update own category shares | w | has_withcheck = false
--   objects                | group-images update own              | w | has_withcheck = false
--   对照：bookmarks / categories / sibling_groups 等均为 true ✅

-- 2.1 分类分享记录
DROP POLICY IF EXISTS "Users can update own category shares" ON public_category_shares;
CREATE POLICY "Users can update own category shares" ON public_category_shares
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2.2 组图片对象（storage）
DROP POLICY IF EXISTS "group-images update own" ON storage.objects;
CREATE POLICY "group-images update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'group-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'group-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ═══════════════════════════════════════════════════════════════════
-- 3. FORCE RLS 补齐（feedback_messages / public_category_shares）
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：015 对 8 张表开了 FORCE，但之后新建的两张表未跟进。
--       public_category_shares 含 user_id 私有数据，漏 FORCE 意味着表 owner
--       （非超级、无 BYPASSRLS）默认不受 RLS 约束。
--       注意：service_role 带 BYPASSRLS，FORCE 不约束它（见 015/020）。
--
-- 实测证据（远程 pg_class.relforcerowsecurity）：
--   feedback_messages      → force_rls = false
--   public_category_shares → force_rls = false
--   其余 8 张表 → true ✅

ALTER TABLE public_category_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE feedback_messages      FORCE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════
-- 4. error_logs 匿名写入熔断（全局速率上限）
-- ═══════════════════════════════════════════════════════════════════
--
-- 问题：error_logs 的 INSERT 策略为 (user_id IS NULL OR user_id = auth.uid())，
--       任何人可无限写入。016 已加字段长度 CHECK，019 已堵伪造 user_id，
--       但**速率**一直无约束（016 注释自认「列为 follow-up」）。
--       攻击面：脚本循环 POST 即可灌爆存储 / 刷爆 Dashboard。
--
-- 实测证据（anon key，无 Authorization 头）：
--   并发 12 条 POST /rest/v1/error_logs → 12 × 201 Created，零拒绝
--
-- 本修复（方案 A，DB 层粗粒度熔断）：
--   BEFORE INSERT 触发器统计最近 1 分钟的行数，超 200 条即拒绝。
--   这是**全局**熔断而非按 IP——PG RLS 拿不到客户端 IP，真按 IP 限流
--   必须把上报改道 Edge Function（方案 B，见 docs/BACKEND_AUDIT.md 第 P1-4 节）。
--   熔断保证：即便被刷，1 分钟最多 200 行，攻击成本从「无限」降为「可控」，
--   同时不影响正常使用（正常客户端每分钟上报远低于 10 条）。
--
-- 已知局限：READ COMMITTED 下 count 只见已提交行，并发突刺会低估实际速率，
--          故阈值取保守值 200。这是「止损」不是「限流」，方案 B 才是根治。
--
-- 成本：每次 INSERT 走 idx_error_logs_created 做一次索引范围计数，
--       error_logs 写入频率低（实测 192 kB），开销可忽略。
--
-- 回滚：DROP TRIGGER IF EXISTS trg_error_logs_throttle ON error_logs;
--       DROP FUNCTION IF EXISTS throttle_error_logs();

CREATE OR REPLACE FUNCTION public.throttle_error_logs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent integer;
BEGIN
  SELECT count(*) INTO v_recent
  FROM error_logs
  WHERE created_at > now() - interval '1 minute';

  IF v_recent >= 200 THEN
    RAISE EXCEPTION 'error_logs rate limit exceeded (200/min)'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.throttle_error_logs() IS
  'error_logs 全局写入熔断：1 分钟 200 条上限（方案 A 止损）。'
  '按 IP 限流需改道 Edge Function（方案 B），见 docs/BACKEND_AUDIT.md。';

DROP TRIGGER IF EXISTS trg_error_logs_throttle ON error_logs;
CREATE TRIGGER trg_error_logs_throttle
  BEFORE INSERT ON error_logs FOR EACH ROW
  EXECUTE FUNCTION throttle_error_logs();


-- ═══════════════════════════════════════════════════════════════════
-- 5. plpgsql 函数 search_path 固定（Supabase linter: function_search_path_mutable）
-- ═══════════════════════════════════════════════════════════════════
-- 001 的 update_updated_at 与 009 的 prune_data_history 未固定 search_path，
-- 触发器在任何 schema 下被执行时，其中的表名解析依赖调用方 search_path，
-- 可被诱导解析到攻击者可写的 schema 下的同名表。固定为 public 消除歧义。
-- 实测：这两个函数 search_path_mutable = true，而 018/020/025 的函数均为 false ✅

ALTER FUNCTION public.update_updated_at()  SET search_path = public;
ALTER FUNCTION public.prune_data_history() SET search_path = public;


-- ═══════════════════════════════════════════════════════════════════
-- 6. 清理无效索引
-- ═══════════════════════════════════════════════════════════════════
-- 005 建的 idx_sibling_groups_public ON sibling_groups(id) WHERE is_public = TRUE
-- 是无效索引：id 已是主键，该部分索引不提供任何额外选择性，
-- 只增加写入开销与存储。公开组查找现由 RPC 按主键 id 直查，无需此索引。

DROP INDEX IF EXISTS idx_sibling_groups_public;


-- 通知 PostgREST 重载 schema
SELECT pg_notify('pgrst', 'reload schema');
