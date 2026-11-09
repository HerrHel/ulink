-- 第二轮深审数据库加固 3/3（2026-11-09）：anon RPC 的归属校验
-- 生产库实测 anon 可执行 get_payment_order / ai_quota_check / consume_daily_feature_quota，
-- 且内部拿客户端传入的 p_uid 当归属校验：p_uid IS NULL 时 "<>" 求值为 NULL 直接绕过。
-- ⚠️ 不能 REVOKE anon：云函数 rdb 走 tcbopenapi 身份，映射到 anon/authenticated，
--    收回会 42501（见 20261028000010:396-399）。故在函数内做 fail-closed 校验。

BEGIN;

CREATE OR REPLACE FUNCTION public.get_payment_order(p_order_id text, p_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  -- 旧逻辑 NOT FOUND OR user_id <> p_uid：NULL 时三值逻辑为 NULL，IF 视为假直接放行
  IF p_order_id IS NULL OR p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'order', jsonb_build_object(
    'orderId', v_order.id, 'planId', v_order.plan_id,
    'amountCents', v_order.amount_cents, 'currency', v_order.currency,
    'channel', v_order.channel, 'status', v_order.status,
    'qrCode', v_order.pay_payload ->> 'qrCode',
    'paidAt', v_order.paid_at, 'expiresAt', v_order.expires_at,
    'createdAt', v_order.created_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_quota_check(p_uid text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ent jsonb; v_status text; v_free_lim numeric; v_limit numeric;
  v_used numeric; v_plan_id text;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('plan_id', 'free', 'status', 'invalid',
      'limit_tokens', 0, 'used_tokens', 0, 'remaining', 0, 'exceeded', true);
  END IF;
  v_ent := public.resolve_entitlement(p_uid);
  v_status := coalesce(v_ent ->> 'status', 'active');
  IF v_status IN ('expired', 'refunded') THEN
    SELECT coalesce((features ->> 'ai.tokens.monthly')::numeric, 50000) INTO v_free_lim
      FROM public.plans WHERE id = 'free';
    v_limit := coalesce(v_free_lim, 50000); v_plan_id := 'free';
  ELSE
    v_limit := coalesce((v_ent -> 'features') ->> 'ai.tokens.monthly', '50000')::numeric;
    v_plan_id := v_ent ->> 'plan_id';
  END IF;
  SELECT coalesce(sum(amount), 0) / 2 INTO v_used
    FROM public.usage_ledger
   WHERE user_id = p_uid AND metric = 'ai.chars'
     AND period = to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM');
  RETURN jsonb_build_object('plan_id', v_plan_id, 'status', v_status,
    'limit_tokens', v_limit, 'used_tokens', v_used,
    'remaining', v_limit - v_used, 'exceeded', v_used >= v_limit);
END;
$$;

-- 该函数全仓无调用方（死函数），仍对 anon 开放且 p_feature / p_key_prefix 完全外部可控，
-- 可指向 storage.bytes 之类大值键绕过额度口径、或针对他人 uid 刷爆限流。
CREATE OR REPLACE FUNCTION public.consume_daily_feature_quota(
  p_uid text, p_feature text, p_key_prefix text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ent jsonb; v_features jsonb; v_limit integer; v_key text; v_ok boolean;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily') THEN
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
  -- 忽略客户端 p_key_prefix，服务端固定前缀，防止构造他人限流键
  v_key := 'feature:' || p_feature || ':' || p_uid || ':' ||
           to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');
  v_ok := public.consume_rate_limit(v_key, v_limit, 86400);
  RETURN jsonb_build_object('ok', v_ok IS TRUE, 'limited', true, 'limit', v_limit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_daily_feature_quota(text,text,text) FROM anon;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
