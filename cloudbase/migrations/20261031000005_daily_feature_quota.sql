-- 每日额度统一入口：按 plan 的 feature 键消费「自然日」配额（Asia/Shanghai）
--
-- 背景：mimo-chat / check-link 需要按 plans.features 的每日额度限流。
-- 直接 resolve_entitlement + consume_rate_limit 有两个问题：
--   1) 订阅 expired/refunded 时 resolve_entitlement 仍返回付费档 features（与
--      ai_quota_check 已修的漏洞同类），必须在消费前回落 free 档；
--   2) 逻辑分散在两个函数里，口径容易漂移。
-- 因此集中到 SECURITY DEFINER 函数：解析权益（含过期回落 free）、取 feature 值、
-- 按 UTC+8 自然日消费 consume_rate_limit，返回 { ok, limited, limit }。
--
-- 幂等：CREATE OR REPLACE。

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_daily_feature_quota(
  p_uid        text,
  p_feature    text,
  p_key_prefix text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent      jsonb;
  v_features jsonb;
  v_limit    integer;
  v_key      text;
  v_ok       boolean;
BEGIN
  IF p_uid IS NULL OR p_uid = '' OR p_feature IS NULL OR p_key_prefix IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'limited', false, 'reason', 'bad_args');
  END IF;

  v_ent := public.resolve_entitlement(p_uid);
  IF v_ent IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'limited', false, 'reason', 'no_entitlement');
  END IF;

  -- 过期/已退款：回落 free 档额度（与 ai_quota_check 的 2026-10-31 修复一致）
  IF coalesce(v_ent->>'status', '') IN ('expired', 'refunded') THEN
    SELECT features INTO v_features FROM public.plans WHERE id = 'free';
    IF v_features IS NULL THEN
      v_features := v_ent->'features';
    END IF;
  ELSE
    v_features := v_ent->'features';
  END IF;

  v_limit := (v_features ->> p_feature)::int;
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'limited', false, 'reason', 'feature_not_configured');
  END IF;
  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'limit', 0);
  END IF;

  v_key := p_key_prefix || p_uid || ':' || to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');
  v_ok := public.consume_rate_limit(v_key, v_limit, 86400);

  RETURN jsonb_build_object('ok', v_ok IS TRUE, 'limited', true, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_daily_feature_quota(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_daily_feature_quota(text, text, text) TO service_role, authenticated;

COMMENT ON FUNCTION public.consume_daily_feature_quota(text, text, text) IS
  '按 plans.features 的每日额度做原子消费（UTC+8 自然日；expired/refunded 回落 free）。调用方：mimo-chat / check-link。';

COMMIT;
