-- reserve_quota：订阅过期/退款后按免费档额度预扣
--
-- 背景（2026-11-10 排查）：
--   resolve_entitlement() 在 expires_at < now() 时返回 status='expired'，
--   但 features 仍是原付费方案；ai_quota_check 已在 20261031000002 做了 free 回落，
--   而 mimo-chat enforce 模式实际走的 reserve_quota 只读 features、不看 status，
--   导致 PRO 到期后仍可按 20 万 token/月预扣（free 仅 2 万）。
--
-- 语义：
--   - status ∈ ('expired','refunded') → features 回落 plans.id='free'；
--   - 其它状态维持原逻辑；
--   - 返回结构与并发锁、超额判定保持不变。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.reserve_quota(
  p_uid    text,
  p_metric text,
  p_amount numeric,
  p_period text,
  p_ref    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent   jsonb;
  v_feat  jsonb;
  v_limit numeric;
  v_used  numeric;
BEGIN
  IF p_uid IS NULL OR p_metric IS NULL OR p_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  -- 并发防双花：同一 (uid,metric,period) 串行化，
  -- 否则两个并发请求都读到 used=limit-1 会各自通过校验
  PERFORM pg_advisory_xact_lock(hashtext(p_uid || ':' || p_metric || ':' || p_period));

  v_ent  := public.resolve_entitlement(p_uid);
  v_feat := v_ent -> 'features';

  -- 过期/已退款：一律回落到免费档权益，避免到期后继续占用 PRO 额度
  IF coalesce(v_ent ->> 'status', 'active') IN ('expired', 'refunded') THEN
    SELECT features INTO v_feat FROM public.plans WHERE id = 'free';
  END IF;

  v_limit := coalesce((v_feat ->> p_metric)::numeric, 0);

  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'metric', p_metric);
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_used
    FROM public.usage_ledger
   WHERE user_id = p_uid AND metric = p_metric AND period = p_period;

  IF v_used + p_amount > v_limit THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'quota_exceeded',
      'used', v_used, 'limit', v_limit, 'metric', p_metric
    );
  END IF;

  INSERT INTO public.usage_ledger (user_id, metric, amount, ref, period, kind)
  VALUES (p_uid, p_metric, p_amount, p_ref, period, 'reserve');

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_amount, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quota(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(text, text, numeric, text, text) TO service_role;

COMMENT ON FUNCTION public.reserve_quota(text, text, numeric, text, text) IS
  '预扣配额（原子）。expired/refunded 权益按 plans.id=free 的 features 计算（2026-11-10）。';
