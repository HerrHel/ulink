-- redeem_code：支持兑换码过期（orders.expires_at）
--
-- 背景（2026-11-10 排查）：
--   redeem_code 只校验 status='pending'，从不读 expires_at；
--   gen-redeem-codes 也不写该列，导致运营无法给兑换码设置有效期，过期码永久可兑。
--
-- 语义：
--   - orders.expires_at 非空且已过 → 返回 {ok:false, reason:'expired'}，不核销、不发权益；
--   - expires_at 为 NULL（历史永久码）→ 保持原有永久可兑行为；
--   - 其余逻辑（FOR UPDATE 串行化、原子占用、权益叠加）保持不变。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

BEGIN;

CREATE OR REPLACE FUNCTION public.redeem_code(p_code text, p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_plan    public.plans%ROWTYPE;
  v_updated integer;
  v_expires timestamptz;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_user');
  END IF;

  -- FOR UPDATE 锁行：并发核销同一码时串行化
  SELECT * INTO v_order
    FROM public.orders
   WHERE idempotency_key = upper(trim(p_code))
     AND channel = 'redeem'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
  END IF;
  -- 过期码不再核销（NULL = 永久码，保持兼容）
  IF v_order.expires_at IS NOT NULL AND v_order.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired', 'expires_at', v_order.expires_at);
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = v_order.plan_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_inactive');
  END IF;

  -- 条件更新：仅当仍为 pending 时才占用（原子防双兑）
  UPDATE public.orders
     SET user_id = p_uid, status = 'paid', paid_at = now()
   WHERE id = v_order.id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
  END IF;

  -- 发放权益（首次兑换走 INSERT；重复兑换同一用户走叠加）
  INSERT INTO public.entitlements
    (user_id, plan_id, status, source, started_at, expires_at, updated_at)
  VALUES
    (p_uid, v_plan.id, 'active', 'redeem', now(),
     now() + make_interval(days => v_plan.period_days), now())
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id    = EXCLUDED.plan_id,
    status     = 'active',
    source     = 'redeem',
    expires_at = CASE
      WHEN public.entitlements.expires_at IS NOT NULL
       AND public.entitlements.expires_at > now()
      THEN public.entitlements.expires_at + make_interval(days => v_plan.period_days)
      ELSE EXCLUDED.expires_at
    END,
    updated_at = now();

  SELECT expires_at INTO v_expires FROM public.entitlements WHERE user_id = p_uid;

  RETURN jsonb_build_object(
    'ok',         true,
    'plan_id',    v_plan.id,
    'plan_name',  v_plan.name,
    'expires_at', to_char(v_expires, 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_code(text, text) TO service_role;

COMMENT ON FUNCTION public.redeem_code(text, text) IS
  '仅 service_role：核销兑换码并发放权益。幂等；支持 orders.expires_at 过期拦截；期限可叠加。';

COMMIT;
