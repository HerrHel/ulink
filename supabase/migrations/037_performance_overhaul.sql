-- 037_performance_overhaul.sql
-- 全面性能优化：解决 JSONB 全表扫描、补充递归必备索引、消除死链高频锁竞争、剥离过期 RLS 性能税

BEGIN;

-- 1. 补充递归查询和层级结构必备的 parent_id 索引，消除 WITH RECURSIVE 全表扫描
CREATE INDEX IF NOT EXISTS idx_bookmarks_parent_id ON public.bookmarks (user_id, parent_id);

-- 2. 剥离 010/013 遗留的昂贵 RLS 性能税 (因 036 RPC 已全面接管公开分享的匿名读业务)
-- 剥离 bookmarks 的匿名只读 RLS（存在极耗性能的 EXISTS 子查询）
DROP POLICY IF EXISTS "Anyone can view bookmarks in public groups" ON public.bookmarks;
-- 顺带剥离 sibling_groups 的匿名只读 RLS（减少不必要的安全平面暴露）
DROP POLICY IF EXISTS "Anyone can view public groups" ON public.sibling_groups;
DROP POLICY IF EXISTS "Public groups are readable by anyone" ON public.sibling_groups;

-- 3. 重写死链检测限流器：引入概率清理机制，消除高频锁死
CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_limit INTEGER, p_window_secs INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 1; END IF;
  IF p_window_secs IS NULL OR p_window_secs < 1 THEN p_window_secs := 60; END IF;

  INSERT INTO private.rate_limit_counters AS r (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_secs) THEN now()
      ELSE r.window_start END,
    count = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_secs) THEN 1
      ELSE r.count + 1 END
  RETURNING count INTO v_count;

  -- 【优化】仅 5% 概率执行过期数据清理，极大缓解高并发场景的行锁竞争与磁盘 IO 尖峰
  IF random() < 0.05 THEN
    DELETE FROM private.rate_limit_counters
     WHERE window_start < now() - make_interval(secs => p_window_secs * 10);
  END IF;

  RETURN v_count <= p_limit;
END;
$$;

-- 4. 重构 RPC: get_public_group 消除 JSONB 包含引发的全表扫描
CREATE OR REPLACE FUNCTION public.get_public_group(p_gid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g_id text; g_name text; g_category_id text; g_icon text; g_order integer;
  g_is_expanded boolean; g_attributes jsonb; g_bookmark_ids jsonb;
  g_notes text; g_use_count integer; g_is_public boolean;
  g_updated_at_num bigint; g_deleted_at timestamptz; g_user_id uuid;
  bms jsonb;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0 THEN RETURN NULL; END IF;

  SELECT
    sg.id, sg.name, sg.category_id, sg.icon, sg."order", sg.is_expanded,
    sg.attributes, sg.bookmark_ids, sg.notes, sg.use_count, sg.is_public,
    sg.updated_at_num, sg.deleted_at, sg.user_id
  INTO
    g_id, g_name, g_category_id, g_icon, g_order, g_is_expanded,
    g_attributes, g_bookmark_ids, g_notes, g_use_count, g_is_public,
    g_updated_at_num, g_deleted_at, g_user_id
  FROM sibling_groups sg
  WHERE sg.id = p_gid AND sg.is_public = true AND sg.deleted_at IS NULL;

  IF g_id IS NULL THEN RETURN NULL; END IF;

  -- 【优化】利用 jsonb_array_elements_text 与 JOIN 直接命中 (user_id, id) 复合主键，杜绝全表扫描
  WITH RECURSIVE group_bms AS (
    SELECT b.*
    FROM jsonb_array_elements_text(g_bookmark_ids) AS x(bid)
    JOIN bookmarks b ON b.id = x.bid AND b.user_id = g_user_id
    WHERE b.deleted_at IS NULL
    UNION
    SELECT child.*
    FROM bookmarks child
    JOIN group_bms parent ON child.parent_id = parent.id
    WHERE child.user_id = g_user_id AND child.deleted_at IS NULL
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id, 'title', b.title, 'url', b.url, 'notes', b.notes,
        'icon', b.icon, 'category_id', b.category_id, 'parent_id', b.parent_id,
        'order', b."order", 'attributes', b.attributes, 'is_expanded', b.is_expanded,
        'created_at_num', b.created_at_num, 'updated_at_num', b.updated_at_num,
        'deleted_at', b.deleted_at
      )
      ORDER BY b."order" ASC NULLS LAST, b.id ASC
    ), '[]'::jsonb
  ) INTO bms FROM group_bms b;

  RETURN jsonb_build_object(
    'group', jsonb_build_object(
      'id', g_id, 'name', g_name, 'category_id', g_category_id,
      'icon', COALESCE(g_icon, ''), 'order', COALESCE(g_order, 0),
      'is_expanded', COALESCE(g_is_expanded, false), 'attributes', COALESCE(g_attributes, '{}'::jsonb),
      'bookmark_ids', COALESCE(g_bookmark_ids, '[]'::jsonb), 'notes', COALESCE(g_notes, ''),
      'use_count', COALESCE(g_use_count, 0), 'is_public', true,
      'updated_at_num', COALESCE(g_updated_at_num, 0), 'deleted_at', g_deleted_at
    ),
    'bookmarks', bms
  );
END;
$$;

-- 5. 重构 RPC: get_public_category 消除笛卡尔积级 O(N*M) 全表扫描
CREATE OR REPLACE FUNCTION public.get_public_category(p_share_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid; v_cat_id text; v_cat_name text; v_cat_icon text; v_cat_color text;
  v_grps jsonb; v_bms jsonb;
BEGIN
  IF p_share_id IS NULL OR length(trim(p_share_id)) = 0 THEN RETURN NULL; END IF;

  SELECT user_id, category_id INTO v_uid, v_cat_id FROM public_category_shares WHERE id = p_share_id;
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT name, COALESCE(icon, ''), COALESCE(color, '') INTO v_cat_name, v_cat_icon, v_cat_color
  FROM categories WHERE id = v_cat_id AND user_id = v_uid;
  IF v_cat_name IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sg.id, 'name', sg.name, 'category_id', sg.category_id,
        'icon', COALESCE(sg.icon, ''), 'order', sg."order", 'is_expanded', sg.is_expanded,
        'attributes', COALESCE(sg.attributes, '{}'::jsonb), 'bookmark_ids', COALESCE(sg.bookmark_ids, '[]'::jsonb),
        'notes', COALESCE(sg.notes, ''), 'use_count', COALESCE(sg.use_count, 0),
        'is_public', COALESCE(sg.is_public, false), 'updated_at_num', COALESCE(sg.updated_at_num, 0),
        'deleted_at', sg.deleted_at
      ) ORDER BY sg."order" ASC NULLS LAST, sg.id ASC
    ), '[]'::jsonb
  ) INTO v_grps FROM sibling_groups sg
  WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL AND sg.category_id = v_cat_id;

  -- 【优化】分离 category 的直属书签，与 group 中引用书签的精确提取 (利用 JOIN，避免 OR EXISTS)
  WITH RECURSIVE cat_bms AS (
    SELECT b.*
    FROM bookmarks b
    WHERE b.user_id = v_uid AND b.deleted_at IS NULL AND b.category_id = v_cat_id
    UNION
    SELECT b.*
    FROM sibling_groups sg
    CROSS JOIN jsonb_array_elements_text(sg.bookmark_ids) AS x(bid)
    JOIN bookmarks b ON b.id = x.bid AND b.user_id = v_uid
    WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL AND sg.category_id = v_cat_id AND b.deleted_at IS NULL
    UNION
    SELECT child.*
    FROM bookmarks child
    JOIN cat_bms parent ON child.parent_id = parent.id
    WHERE child.user_id = v_uid AND child.deleted_at IS NULL
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id, 'title', b.title, 'url', b.url, 'notes', b.notes,
        'icon', b.icon, 'category_id', b.category_id, 'parent_id', b.parent_id,
        'order', b."order", 'attributes', b.attributes, 'is_expanded', b.is_expanded,
        'created_at_num', b.created_at_num, 'updated_at_num', b.updated_at_num,
        'deleted_at', b.deleted_at
      ) ORDER BY b."order" ASC NULLS LAST, b.id ASC
    ), '[]'::jsonb
  ) INTO v_bms FROM cat_bms b;

  RETURN jsonb_build_object(
    'category', jsonb_build_object('id', v_cat_id, 'name', v_cat_name, 'icon', v_cat_icon, 'color', v_cat_color),
    'groups', v_grps, 'bookmarks', v_bms
  );
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
