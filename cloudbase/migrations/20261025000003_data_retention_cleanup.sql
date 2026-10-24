-- 数据保留期清理 + 账号注销数据清除
--
-- 背景：法律文档已对外承诺两项**可执行**的义务，��须有对应的技术实现，否则构成虚假承诺：
--   ① 错误日志保留不超过 12 个月（隐私政策 §5.3）
--   ② 账号注销后核验身份 30 日内删除服务器数据（协议 §6.3 / 隐私 §5.2）
--
-- 设计：
-- - 清理逻辑放在 SECURITY DEFINER 函数里，由**定时云函数**调用（不依赖 pg_cron，
--   CloudBase PG 是否启用 cron 扩展不确定，走应用侧定时最稳）；
-- - 回收站默认**不自动清理**（p_trash_days=0），与隐私政策「不设自动过期」的表述一致；
--   如需开启，传 >0 即可，产品侧可随时改口径；
-- - purge_user_data 只清数据、不删 CloudBase 账号本身（账号删除需走 CloudBase 控制台/API，
--   由云函数在数据清除后调用）。

BEGIN;

-- ── 1. 过期数据清理 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_data(
  p_error_log_days integer DEFAULT 365,
  p_trash_days     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs  integer := 0;
  v_trash integer := 0;
  v_bm    integer := 0;
  v_grp   integer := 0;
BEGIN
  IF p_error_log_days IS NULL OR p_error_log_days < 1 THEN
    p_error_log_days := 365;
  END IF;

  -- ① 错误日志：超过保留期即删除
  DELETE FROM public.error_logs
   WHERE created_at < now() - make_interval(days => p_error_log_days);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- ② 回收站软删除数据：默认不清理（p_trash_days=0 表示关闭）
  IF p_trash_days > 0 THEN
    DELETE FROM public.bookmarks
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => p_trash_days);
    GET DIAGNOSTICS v_bm = ROW_COUNT;

    DELETE FROM public.sibling_groups
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => p_trash_days);
    GET DIAGNOSTICS v_grp = ROW_COUNT;

    v_trash := v_bm + v_grp;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'error_logs_deleted', v_logs,
    'trash_deleted', v_trash,
    'trash_enabled', (p_trash_days > 0),
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_data(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_data(integer, integer) TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_data(integer, integer) IS
  '清理过期错误日志（默认 365 天）与可选的回收站软删除数据（默认关闭）。由定时云函数调用。';

-- ── 2. 账号注销：清除该用户的全部服务器数据 ─────────────────────────
-- 幂等：重复调用不报错（已无数据即返回 ok）。
-- 注意：对象存储里的图片（group-images）不在 PG 内，需由云函数另行删除。
CREATE OR REPLACE FUNCTION public.purge_user_data(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger  integer := 0;
  v_orders  integer := 0;
  v_bm      integer := 0;
  v_grp     integer := 0;
  v_cat     integer := 0;
  v_attr    integer := 0;
  v_sec     integer := 0;
  v_logs    integer := 0;
  v_check   integer := 0;
  v_share   integer := 0;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  DELETE FROM public.usage_ledger   WHERE user_id = p_uid; GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM public.orders         WHERE user_id = p_uid; GET DIAGNOSTICS v_orders = ROW_COUNT;
  DELETE FROM public.entitlements   WHERE user_id = p_uid;
  DELETE FROM public.link_check_history WHERE user_id = p_uid; GET DIAGNOSTICS v_check = ROW_COUNT;
  DELETE FROM public.error_logs     WHERE user_id = p_uid; GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- 分享相关：先删分享记录，避免留下指向已删组的孤立行
  DELETE FROM public.public_category_shares WHERE user_id = p_uid; GET DIAGNOSTICS v_share = ROW_COUNT;

  DELETE FROM public.custom_attributes WHERE user_id = p_uid; GET DIAGNOSTICS v_attr = ROW_COUNT;
  DELETE FROM public.user_security     WHERE user_id = p_uid; GET DIAGNOSTICS v_sec  = ROW_COUNT;
  DELETE FROM public.bookmarks         WHERE user_id = p_uid; GET DIAGNOSTICS v_bm   = ROW_COUNT;
  DELETE FROM public.sibling_groups    WHERE user_id = p_uid; GET DIAGNOSTICS v_grp  = ROW_COUNT;
  DELETE FROM public.categories        WHERE user_id = p_uid; GET DIAGNOSTICS v_cat  = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'usage_ledger', v_ledger, 'orders', v_orders, 'bookmarks', v_bm,
      'sibling_groups', v_grp, 'categories', v_cat, 'custom_attributes', v_attr,
      'user_security', v_sec, 'error_logs', v_logs, 'link_check_history', v_check,
      'public_category_shares', v_share
    ),
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_user_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(text) TO service_role;

COMMENT ON FUNCTION public.purge_user_data(text) IS
  '仅 service_role：清除指定 uid 的全部服务器数据（账号注销用）。幂等；不含对象存储图片。';

-- ── 3. 列出用户的上传图片路径（对象存储清理用）────────────────────
-- CloudBase node-sdk 没有 listFiles，无法枚举存储；图片路径记录在分组笔记的
-- <img src=".../object/public/group-images/{userId}/{groupId}/{file}"> 中，
-- 因此从 notes 里正则提取即可覆盖全部上传图片。
CREATE OR REPLACE FUNCTION public.list_user_image_paths(p_uid text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paths text[];
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[])
    INTO v_paths
    FROM public.sibling_groups sg
    CROSS JOIN LATERAL regexp_matches(
      coalesce(sg.notes, ''), '/object/public/group-images/([^"''\s>]+)', 'g'
    ) AS m
   WHERE sg.user_id = p_uid;

  RETURN v_paths;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_image_paths(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_image_paths(text) TO service_role;

COMMENT ON FUNCTION public.list_user_image_paths(text) IS
  '仅 service_role：返回该用户在对象存储中已上传图片的相对路径（不含 bucket 前缀），供删除使用。';

COMMIT;
