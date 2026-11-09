-- 分享访问密码下沉到数据层（2026-11-09）
-- 背景：密码此前只做在 share-ssr 网关层，而 get_public_group / get_public_category
-- 是 GRANT anon 的公开 RPC，客户端可绕过网关直连取到带密/未公开内容。
-- 修法：① 新增仅 service_role 可读的 get_public_group_verified 供 SSR 验票后调用；
--       ② 公开 get_public_group 只返回无密码组；
--       ③ get_public_category 排除带密组及其组内书签。
-- 分类分享仍按产品定义带出该分类下未公开的普通组，但不带出已设密码的组。

BEGIN;

-- 1. 完整内容版（仅 service_role）
CREATE OR REPLACE FUNCTION public.get_public_group_verified(p_gid text)
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
  g_updated_at_num bigint; g_deleted_at timestamptz; g_user_id text;
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

REVOKE ALL ON FUNCTION public.get_public_group_verified(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_group_verified(text) TO service_role;

-- 2. 公开版：带密组一律返回 NULL
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
  g_updated_at_num bigint; g_deleted_at timestamptz; g_user_id text;
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
  WHERE sg.id = p_gid AND sg.is_public = true AND sg.deleted_at IS NULL
    AND (sg.share_password_hash IS NULL OR length(trim(sg.share_password_hash)) = 0);

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

-- 3. 分类分享：排除带密组及其组内专属书签
CREATE OR REPLACE FUNCTION public.get_public_category(p_share_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text; v_cat_id text; v_cat_name text; v_cat_icon text; v_cat_color text;
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
  WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL AND sg.category_id = v_cat_id
    AND (sg.share_password_hash IS NULL OR length(trim(sg.share_password_hash)) = 0);

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
    WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL AND sg.category_id = v_cat_id
    AND (sg.share_password_hash IS NULL OR length(trim(sg.share_password_hash)) = 0) AND b.deleted_at IS NULL
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
