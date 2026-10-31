-- 退款后自动降级：mark_order_refunded 在「全额退款」时终止该用户的会员权益
--
-- 背景（2026-10-31 审计）：
--   原实现只更新 orders.status/refunded_cents，不动 entitlements，
--   导致「退款成功但 PRO 权益继续生效」，与《退款政策》3.6 相悖；
--   且 refunded_cents 累加无上限校验，多次部分退款可超过订单金额。
--
-- 本次语义（与退款政策一致）：
--   - 单次退款额必须 >0、且累计退款不得超过订单金额；
--   - 累计退款达到订单金额 → orders.status='refunded'，并把该用户当前
--     active/grace 的付费权益置为 status='refunded' 且 expires_at=now()
--     （resolve_entitlement 与 ai_quota_check 都会因此回落 free 额度）；
--   - 部分退款只留痕，不降级（可多次，直到累计满额）。
--
-- 已知边界：若用户同时叠加了多笔订单，全额退其中一笔会终止当前权益（可能偏严），
--   属于当前简化语义；需要按订单精确扣减时再引入 entitlement ↔ order 关联。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.mark_order_refunded(
  p_order_id  text,
  p_cents     integer,
  p_raw       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_updated    integer;
  v_new_total  integer;
  v_full       boolean;
  v_downgraded boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paid', 'status', v_order.status);
  END IF;
  IF p_cents IS NULL OR p_cents <= 0 OR p_cents > v_order.amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_refund_amount');
  END IF;

  v_new_total := coalesce(v_order.refunded_cents, 0) + p_cents;
  IF v_new_total > v_order.amount_cents THEN
    -- 累计退款不能超过订单金额（此前缺失的校验）
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'refund_exceeds_order',
      'amount_cents', v_order.amount_cents,
      'refunded_cents', coalesce(v_order.refunded_cents, 0)
    );
  END IF;
  v_full := v_new_total >= v_order.amount_cents;

  UPDATE public.orders
     SET status          = CASE WHEN v_full THEN 'refunded' ELSE status END,
         refunded_cents  = v_new_total,
         refunded_at     = now(),
         raw_callback    = coalesce(raw_callback, '{}'::jsonb)
                             || jsonb_build_object('refund', p_raw)
   WHERE id = p_order_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_full AND v_updated > 0 THEN
    -- 退款即终止当前付费权益（free 档无 entitlements 行，无需处理）
    UPDATE public.entitlements
       SET status     = 'refunded',
           expires_at = least(coalesce(expires_at, now()), now()),
           updated_at = now()
     WHERE user_id = v_order.user_id
       AND plan_id <> 'free'
       AND status IN ('active', 'grace');
    GET DIAGNOSTICS v_downgraded = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_updated > 0,
    'full_refund', v_full,
    'refunded_cents', v_new_total,
    'downgraded', v_full AND v_downgraded > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_order_refunded(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_refunded(text, integer, jsonb) TO service_role;

COMMENT ON FUNCTION public.mark_order_refunded(text, integer, jsonb) IS
  '退款留痕 + 全额退款自动降级（2026-10-31）。累计退款不得超过订单额；真正退款由云函数/后台调渠道 API 成功后再调本函数。';
