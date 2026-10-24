-- 分享访问密码（私有链接的第二道锁）
--
-- 设计要点：
-- 1) hash 只存 scrypt 结果，且**永不出现在 get_public_group 的列白名单里**；
-- 2) 读 hash 的 RPC 与写 hash 的 RPC 都**只授予 service_role**，anon/authenticated 不可执行；
-- 3) 云函数在「未验密」时根本不会调用 get_public_group —— 内容不下发、不缓存，
--    比「先取内容再遮挡」少一个泄露面；
-- 4) 写密码必须带 user_id 匹配，天然防越权（云函数侧再用 cb-auth 取 uid 填入）。

BEGIN;

-- ── 1. 字段 ──────────────────────────────────────────────────────────
ALTER TABLE public.sibling_groups
  ADD COLUMN IF NOT EXISTS share_password_hash TEXT;

COMMENT ON COLUMN public.sibling_groups.share_password_hash IS
  '分享访问密码的 scrypt 摘要（格式 scrypt$N$r$p$saltB64$hashB64）。NULL 或空串=无密码。绝不下发到客户端。';

-- 有密码的组数量极少，部分是部分索引，避免给主表加无谓的写放大
CREATE INDEX IF NOT EXISTS idx_sibling_groups_has_password
  ON public.sibling_groups (id)
  WHERE share_password_hash IS NOT NULL;

-- ── 2. 读：供云函数判断是否需要密码 / 取摘要比对 ────────────────────
-- 返回 NULL 表示「组不存在 / 未公开 / 已删除」，与「存在但无密码」严格区分：
-- 前者应给 404，后者应正常渲染。
CREATE OR REPLACE FUNCTION public.get_share_secret(p_gid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_found boolean;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT sg.share_password_hash
    INTO v_hash
    FROM sibling_groups sg
   WHERE sg.id = p_gid
     AND sg.is_public = true
     AND sg.deleted_at IS NULL;

  v_found := FOUND;
  IF NOT v_found THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'has_password', (v_hash IS NOT NULL AND length(trim(v_hash)) > 0),
    'password_hash', v_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_share_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_share_secret(text) TO service_role;

COMMENT ON FUNCTION public.get_share_secret(text) IS
  '仅 service_role：返回分享密码摘要供云函数比对。返回 NULL = 组不存在/未公开/已删除。';

-- ── 3. 写：设置或清除密码 ────────────────────────────────────────────
-- p_user_id 由云函数用 cb-auth 校验后的 uid 填入，RPC 内再按 user_id 匹配，
-- 双重保证「只能改自己的组」。
CREATE OR REPLACE FUNCTION public.set_share_password(
  p_gid text,
  p_user_id text,
  p_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0 THEN
    RETURN false;
  END IF;
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN false;
  END IF;

  UPDATE sibling_groups
     SET share_password_hash = NULLIF(trim(COALESCE(p_hash, '')), ''),
         updated_at = now()
   WHERE id = p_gid
     AND user_id = p_user_id
     AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.set_share_password(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_share_password(text, text, text) TO service_role;

COMMENT ON FUNCTION public.set_share_password(text, text, text) IS
  '仅 service_role：按 (gid, user_id) 设置/清除分享密码摘要。p_hash 传 NULL 或空串=清除。';

COMMIT;
