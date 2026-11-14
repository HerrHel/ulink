-- 线上热修：分类分享绕过组密码 + 全量聚合无上限（第二轮审计 #5 / #29）
--
-- 原 get_public_category 的递归 CTE：
--   ① 直属书签分支 b.category_id = v_cat_id 完全不带密码条件；
--   ② 组分支有 share_password_hash 过滤；
--   ③ 递归子书签分支也没有过滤。
-- 结果：给某组设访问密码后，其书签仍可能随同分类的公开分享（或直接 RPC）被带出。
-- 本补丁从 20261109000001 精确复制函数体，仅新增两处 NOT EXISTS 与聚合 LIMIT 500。
-- CREATE OR REPLACE 幂等，可安全重复执行。

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
      -- 2026-11-14 审计 #5：分类分享原先只在「组」分支排除带密组，直属书签分支
      -- 完全没有密码条件，带密组的书签（title/url/notes）会随之公开。这里按
      -- sibling_groups.bookmark_ids 反查，凡被带密组引用的书签一律排除。
      AND NOT EXISTS (
        SELECT 1 FROM sibling_groups sg
        CROSS JOIN jsonb_array_elements_text(sg.bookmark_ids) AS x(bid)
        WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL
          AND COALESCE(length(trim(sg.share_password_hash)), 0) > 0
          AND x.bid = b.id
      )
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
      AND NOT EXISTS (
        SELECT 1 FROM sibling_groups sg
        CROSS JOIN jsonb_array_elements_text(sg.bookmark_ids) AS x(bid)
        WHERE sg.user_id = v_uid AND sg.deleted_at IS NULL
          AND COALESCE(length(trim(sg.share_password_hash)), 0) > 0
          AND x.bid = child.id
      )
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
  ) INTO v_bms FROM (
     SELECT * FROM cat_bms ORDER BY "order" ASC NULLS LAST, id ASC LIMIT 500
   ) b;

  RETURN jsonb_build_object(
    'category', jsonb_build_object('id', v_cat_id, 'name', v_cat_name, 'icon', v_cat_icon, 'color', v_cat_color),
    'groups', v_grps, 'bookmarks', v_bms
  );
END;
$$;
