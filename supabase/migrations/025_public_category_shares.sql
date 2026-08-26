-- 025_public_category_shares.sql
-- 分类级公开分享：分享「一个分类及其全部书签与组」。
--
-- 背景：现有公开分享（018 get_public_group）只支持单个组（sibling_groups）。
-- 需求：分类右键/长按菜单「分享」→ 分享整个分类。与组分享一样是「引用」而非
-- 快照——分享页每次访问经 RPC 实时读取该分类下当前数据，数据变更即自动反映（热更新）。
--
-- 设计：
-- 1) public_category_shares 表：user_id + category_id 记录谁分享了哪个分类。
--    链接 `/s/c/<share_id>` 中的 share_id 即本表主键（幂等 upsert 复用记录）。
--    分类 id 本身不带用户信息（不同用户可能有同名 id），必须经本表解析出 owner。
-- 2) upsert_public_category_share(p_category_id)：登录用户分享分类 → 返回 share_id。
--    SECURITY INVOKER：INSERT 受表 RLS 约束（仅本人可见/写）。
-- 3) get_public_category(p_share_id)：匿名/登录均可调。SECURITY DEFINER，
--    列级隔离同 018：仅返回展示所需字段，显式排除 username / password / user_id。
-- 4) 书签/组按 category_id 归属（含子书签：子书签 category_id 与父一致）。
--
-- 执行：supabase db push --linked

-- ── 1. 分类分享记录表 ──
CREATE TABLE IF NOT EXISTS public_category_shares (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- 同一用户分享同一分类幂等：upsert 复用同一条记录（链接稳定，分享状态集中管理）
  UNIQUE (user_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_public_category_shares_user ON public_category_shares(user_id);

ALTER TABLE public_category_shares ENABLE ROW LEVEL SECURITY;

-- 仅所有者可读写；匿名/他人一律不可直接 SELECT（公开读走 get_public_category RPC）
CREATE POLICY "Users can view own category shares" ON public_category_shares
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own category shares" ON public_category_shares
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own category shares" ON public_category_shares
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own category shares" ON public_category_shares
  FOR DELETE USING (auth.uid() = user_id);

-- ── 2. 幂等创建/复用分享记录，返回 share_id（链接用）──
CREATE OR REPLACE FUNCTION public.upsert_public_category_share(p_category_id text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_category_id IS NULL OR length(trim(p_category_id)) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public_category_shares (id, user_id, category_id)
  VALUES ('cat_' || substring(gen_random_uuid()::text FROM 1 FOR 20), v_uid, p_category_id)
  ON CONFLICT (user_id, category_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_public_category_share(text) IS
  '登录用户分享分类：幂等创建/复用分享记录，返回 /s/c/<share_id> 链接的 share_id；未登录返回 NULL。';

REVOKE ALL ON FUNCTION public.upsert_public_category_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_public_category_share(text) TO authenticated;

-- ── 3. 分类分享只读 RPC（匿名可调，列级隔离同 018）──
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

  -- 该分类下所有书签（含子书签，未软删）；绝不选 username / password / user_id
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
  FROM bookmarks b
  WHERE b.user_id = v_uid
    AND b.deleted_at IS NULL
    AND b.category_id = v_cat_id;

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
  '分类分享只读：按 share_id 返回分类 + 组 + 书签（展示列，不含 username/password/user_id）。SECURITY DEFINER 绕过 bookmarks/sibling_groups 表 RLS。';

REVOKE ALL ON FUNCTION public.get_public_category(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_category(text) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
