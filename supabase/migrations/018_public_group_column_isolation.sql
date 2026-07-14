-- 018_public_group_column_isolation.sql
-- SEC-01 列级隔离：公开分享不再允许对 bookmarks 表的匿名/跨用户 SELECT。
--
-- 背景：010–013 的 RLS 只控制「哪些行可读」，不控制「哪些列可读」。
-- 匿名访客只要 .select('*') 就能拿到 username / password（RLS 放行整行）。
-- 前端收窄 select 只是客户端自律，可被直接打 PostgREST 绕过。
--
-- 本迁移：
-- 1) 删除 bookmarks 的「Anyone can view bookmarks in public groups」策略
--    （匿名与非所有者从此无法 SELECT 该书签行，含凭证列）
-- 2) 新增 SECURITY DEFINER RPC get_public_group(p_gid)
--    仅返回展示所需字段，显式排除 username / password / user_id
-- 3) 保留 sibling_groups 匿名 SELECT 策略（组表无凭证列，风险可接受）
--
-- 前端 fetchPublicGroup 必须改走 rpc('get_public_group')，直接 from('bookmarks') 会失败。
--
-- 执行：Supabase Dashboard → SQL Editor → 粘贴本文件 → Run

-- ── 1. 撤销书签表匿名/跨用户行级 SELECT（列泄露入口）──
DROP POLICY IF EXISTS "Anyone can view bookmarks in public groups" ON bookmarks;
DROP POLICY IF EXISTS "Bookmarks in public groups are readable by anyone" ON bookmarks;

-- ── 2. 公开组安全读 RPC ──
CREATE OR REPLACE FUNCTION public.get_public_group(p_gid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g_id text;
  g_name text;
  g_category_id text;
  g_icon text;
  g_order integer;
  g_is_expanded boolean;
  g_attributes jsonb;
  g_bookmark_ids jsonb;
  g_notes text;
  g_use_count integer;
  g_is_public boolean;
  g_updated_at_num bigint;
  g_deleted_at timestamptz;
  g_user_id uuid;
  bms jsonb;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT
    sg.id, sg.name, sg.category_id, sg.icon, sg."order", sg.is_expanded,
    sg.attributes, sg.bookmark_ids, sg.notes, sg.use_count, sg.is_public,
    sg.updated_at_num, sg.deleted_at, sg.user_id
  INTO
    g_id, g_name, g_category_id, g_icon, g_order, g_is_expanded,
    g_attributes, g_bookmark_ids, g_notes, g_use_count, g_is_public,
    g_updated_at_num, g_deleted_at, g_user_id
  FROM sibling_groups sg
  WHERE sg.id = p_gid
    AND sg.is_public = true
    AND sg.deleted_at IS NULL;

  IF g_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 仅返回被该公开组引用、同所有者、未软删的书签；绝不选 username / password / user_id
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'title', b.title,
        'url', b.url,
        'notes', b.notes,
        'icon', b.icon,
        'category_id', b.category_id,
        'parent_id', b.parent_id,
        'order', b."order",
        'attributes', b.attributes,
        'is_expanded', b.is_expanded,
        'created_at_num', b.created_at_num,
        'updated_at_num', b.updated_at_num,
        'deleted_at', b.deleted_at
      )
      ORDER BY b."order" ASC NULLS LAST, b.id ASC
    ),
    '[]'::jsonb
  )
  INTO bms
  FROM bookmarks b
  WHERE b.user_id = g_user_id
    AND b.deleted_at IS NULL
    AND g_bookmark_ids @> to_jsonb(ARRAY[b.id]);

  RETURN jsonb_build_object(
    'group', jsonb_build_object(
      'id', g_id,
      'name', g_name,
      'category_id', g_category_id,
      'icon', COALESCE(g_icon, ''),
      'order', COALESCE(g_order, 0),
      'is_expanded', COALESCE(g_is_expanded, false),
      'attributes', COALESCE(g_attributes, '{}'::jsonb),
      'bookmark_ids', COALESCE(g_bookmark_ids, '[]'::jsonb),
      'notes', COALESCE(g_notes, ''),
      'use_count', COALESCE(g_use_count, 0),
      'is_public', true,
      'updated_at_num', COALESCE(g_updated_at_num, 0),
      'deleted_at', g_deleted_at
    ),
    'bookmarks', bms
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_group(text) IS
  '公开分享只读：返回组 + 书签展示列，不含 username/password/user_id。SECURITY DEFINER 绕过 bookmarks 表 RLS。';

REVOKE ALL ON FUNCTION public.get_public_group(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_group(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
