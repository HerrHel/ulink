-- 修复 consume_daily_feature_quota / refund_daily_feature_quota 白名单遗漏 linkcheck.daily
--
-- 背景：
--   20261109000004_rpc_guard_r2.sql 误以为 consume_daily_feature_quota 是死函数，
--   在收紧 p_feature 白名单时把 'linkcheck.daily' 漏掉；20261110000007_refund_daily_feature_quota.sql
--   沿用了同一份白名单。
--   然而 cloudbase/functions/check-link/index.js 仍对所有登录用户（免费 3/日、PRO 50/日）
--   调用 consume_daily_feature_quota(uid, 'linkcheck.daily', 'link-check:uid:')，
--   导致全部登录用户的手动死链检测恒报 bad_args → 429。
--
-- 幂等：CREATE OR REPLACE + REVOKE/GRANT（保留 20261109000005 权限收紧口径，仅 service_role 可调）。

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_daily_feature_quota(
  p_uid text, p_feature text, p_key_prefix text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ent jsonb; v_features jsonb; v_limit integer; v_key text; v_ok boolean;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily', 'linkcheck.daily') THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'reason', 'bad_args');
  END IF;
  v_ent := public.resolve_entitlement(p_uid);
  IF v_ent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'reason', 'no_entitlement');
  END IF;
  IF coalesce(v_ent->>'status', '') IN ('expired', 'refunded') THEN
    SELECT features INTO v_features FROM public.plans WHERE id = 'free';
    IF v_features IS NULL THEN v_features := v_ent->'features'; END IF;
  ELSE
    v_features := v_ent->'features';
  END IF;
  v_limit := (v_features ->> p_feature)::int;
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'reason', 'feature_not_configured');
  END IF;
  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'limit', 0);
  END IF;
  v_key := 'feature:' || p_feature || ':' || p_uid || ':' ||
           to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');
  v_ok := public.consume_rate_limit(v_key, v_limit, 86400);
  RETURN jsonb_build_object('ok', v_ok IS TRUE, 'limited', true, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_daily_feature_quota(
  p_uid     text,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_key     text;
  v_updated integer;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily', 'linkcheck.daily') THEN
    RETURN false;
  END IF;

  v_key := 'feature:' || p_feature || ':' || p_uid || ':' ||
           to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');

  UPDATE private.rate_limit_counters
     SET count = GREATEST(count - 1, 0)
   WHERE key = v_key AND count > 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_daily_feature_quota(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_daily_feature_quota(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.refund_daily_feature_quota(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_daily_feature_quota(text, text) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
