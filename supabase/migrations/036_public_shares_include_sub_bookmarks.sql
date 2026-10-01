-- 036_public_shares_include_sub_bookmarks.sql
-- 修复公开组与公开分类分享 RPC 缺失子书签（parent_id）问题：
-- 1. get_public_group(p_gid)：此前仅按 g_bookmark_ids 匹配直属书签，
--    现通过递归 CTE 将组内书签的所有子书签/孙书签一并递归返回。
-- 2. get_public_category(p_share_id)：此前仅匹配 category_id = v_cat_id，
--    现通过递归 CTE 确保即电子书签未显式写 category_id，只要父书签归属该分类亦完整包含。

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

  -- 递归查询：组内直接引用的书签 + 其全部子书签（parent_id 链）
  WITH RECURSIVE group_bms AS (
    SELECT b.*
    FROM bookmarks b
    WHERE b.user_id = g_user_id
      AND b.deleted_at IS NULL
      AND g_bookmark_ids @> to_jsonb(ARRAY[b.id])
    UNION
    SELECT child.*
    FROM bookmarks child
    JOIN group_bms parent ON child.parent_id = parent.id
    WHERE child.user_id = g_user_id
      AND child.deleted_at IS NULL
  )
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
  FROM group_bms b;

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
  '公开组只读：返回组 + 组内书签及递归子书签，不含 username/password/user_id。SECURITY DEFINER 绕过 bookmarks 表 RLS。';

REVOKE ALL ON FUNCTION public.get_public_group(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_group(text) TO anon, authenticated;

-- ── 2. get_public_category 包含递归子书签 ──
CREATE OR REPLACE FUNCTION public.get_public_category(p_share_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_cat_id text;
  v_cat_name text;
  v_cat_icon text;
  v_cat_color text;
  v_grps jsonb;
  v_bms jsonb;
BEGIN
  IF p_share_id IS NULL OR length(trim(p_share_id)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT user_id, category_id INTO v_uid, v_cat_id
  FROM public_category_shares
  WHERE id = p_share_id;
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name, COALESCE(icon, ''), COALESCE(color, '')
  INTO v_cat_name, v_cat_icon, v_cat_color
  FROM categories
  WHERE id = v_cat_id AND user_id = v_uid;
  IF v_cat_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- 该分类下所有组（未软删）；只返回展示字段
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sg.id,
        'name', sg.name,
        'category_id', sg.category_id,
        'icon', COALESCE(sg.icon, ''),
        'order', sg."order",
        'is_expanded', sg.is_expanded,
        'attributes', COALESCE(sg.attributes, '{}'::jsonb),
        'bookmark_ids', COALESCE(sg.bookmark_ids, '[]'::jsonb),
        'notes', COALESCE(sg.notes, ''),
        'use_count', COALESCE(sg.use_count, 0),
        'is_public', COALESCE(sg.is_public, false),
        'updated_at_num', COALESCE(sg.updated_at_num, 0),
        'deleted_at', sg.deleted_at
      )
      ORDER BY sg."order" ASC NULLS LAST, sg.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_grps
  FROM sibling_groups sg
  WHERE sg.user_id = v_uid
    AND sg.deleted_at IS NULL
    AND sg.category_id = v_cat_id;

  -- 该分类下所有书签（递归包含挂在本分类书签下的子书签，未软删）；绝不选 username / password / user_id
  WITH RECURSIVE cat_bms AS (
    SELECT b.*
    FROM bookmarks b
    WHERE b.user_id = v_uid
      AND b.deleted_at IS NULL
      AND (
        b.category_id = v_cat_id
        OR EXISTS (
          SELECT 1 FROM sibling_groups sg
          WHERE sg.user_id = v_uid
            AND sg.deleted_at IS NULL
            AND sg.category_id = v_cat_id
            AND sg.bookmark_ids @> to_jsonb(ARRAY[b.id])
        )
      )
    UNION
    SELECT child.*
    FROM bookmarks child
    JOIN cat_bms parent ON child.parent_id = parent.id
    WHERE child.user_id = v_uid
      AND child.deleted_at IS NULL
  )
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
  INTO v_bms
  FROM cat_bms b;

  RETURN jsonb_build_object(
    'category', jsonb_build_object(
      'id', v_cat_id,
      'name', v_cat_name,
      'icon', v_cat_icon,
      'color', v_cat_color
    ),
    'groups', v_grps,
    'bookmarks', v_bms
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_category(text) IS
  '公开分类分享只读：返回分类 + 组 + 书签（含递归子书签），不含 username/password/user_id。SECURITY DEFINER 绕过 bookmarks 表 RLS。';

REVOKE ALL ON FUNCTION public.get_public_category(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_category(text) TO anon, authenticated;
