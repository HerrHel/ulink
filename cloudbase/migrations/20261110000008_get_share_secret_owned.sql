-- get_share_secret_owned：按 uid 校验归属的分享密码状态查询
--
-- 背景（2026-11-11 排查）：
--   share-admin 的 action=get 直接调用 get_share_secret(p_gid)，只校验 gid 合法性，
--   任意登录用户可拿别人的公开分享 id 探测其是否设置了访问密码。
--
-- 语义：
--   - 与 get_share_secret 返回结构一致，但额外要求 sibling_groups.user_id = p_uid；
--   - 非本人/不存在/未公开/已删除一律返回 NULL（share-admin 映射为 404，不泄露存在性）；
--   - share-ssr 仍使用原 get_share_secret（渲染分享页需要匿名可读语义）。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

BEGIN;

CREATE OR REPLACE FUNCTION public.get_share_secret_owned(p_gid text, p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash  text;
  v_found boolean;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0
     OR p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT sg.share_password_hash
    INTO v_hash
    FROM sibling_groups sg
   WHERE sg.id = p_gid
     AND sg.user_id = p_uid
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

REVOKE ALL ON FUNCTION public.get_share_secret_owned(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_share_secret_owned(text, text) TO service_role;

COMMENT ON FUNCTION public.get_share_secret_owned(text, text) IS
  '仅 service_role：按 uid 校验归属后返回分享密码摘要。非本人返回 NULL。';

COMMIT;
