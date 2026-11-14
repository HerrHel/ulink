-- 线上热修：settle_paid_order 的金额校验 NULL 短路（第二轮审计 #35）
--
-- 原写法 `IF p_paid_cents IS NOT NULL AND ...` 在实付金额缺失时直接跳过校验发货。
-- 当前三条云函数路径都会拦截 NULL，属纵深缺陷；这里改为 NULL 即拒绝。
-- 函数体从 20261028000010 精确复制，仅改这一行。CREATE OR REPLACE 幂等。

CREATE OR REPLACE FUNCTION public.settle_paid_order(
  p_order_id         text,
  p_channel          text,
  p_channel_order_id text,
  p_paid_cents       integer,   -- 渠道回调里的实付金额（仅用于校验）
  p_raw              jsonb DEFAULT '{}'::jsonb
)
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
  -- FOR UPDATE：同一订单的并发回调串行化
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- 订单与渠道必须匹配（防止用 A 渠道的回调结算 B 渠道的订单）
  IF v_order.channel <> p_channel THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'channel_mismatch');
  END IF;

  -- 幂等：已发货（或已退款/失败）直接返回，不再延长权益
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'not_pending',
      'status',  v_order.status,
      'order_id', v_order.id
    );
  END IF;

  -- 过期订单不再发货（渠道侧可能已扣款，需人工核对后退款，故单独 reason）
  IF v_order.expires_at IS NOT NULL AND v_order.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_expired', 'order_id', v_order.id);
  END IF;

  -- 金额校验：以服务端订单为准，回调金额必须相等（分，整数）
  IF p_paid_cents IS NULL OR p_paid_cents <> v_order.amount_cents THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'reason',  'amount_mismatch',
      'expected', v_order.amount_cents,
      'actual',   p_paid_cents
    );
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = v_order.plan_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;

  -- 条件更新：仅当仍为 pending 时占用（原子防双发，与 redeem_code 同款）
  UPDATE public.orders
     SET status           = 'paid',
         paid_at          = now(),
         notified_at      = now(),
         channel_order_id = coalesce(p_channel_order_id, channel_order_id),
         raw_callback     = p_raw
   WHERE id = p_order_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    -- 竞态：另一并发回调已发货
    RETURN jsonb_build_object('ok', false, 'reason', 'already_settled', 'order_id', p_order_id);
  END IF;

  -- 发放权益：首购 INSERT；续费在当前有效期上叠加（与 redeem_code 一致）
  INSERT INTO public.entitlements
    (user_id, plan_id, status, source, started_at, expires_at, updated_at)
  VALUES
    -- source 固定 'order'（entitlements_source_check 的枚举；渠道明细在 orders.channel）
    (v_order.user_id, v_plan.id, 'active', 'order', now(),
     now() + make_interval(days => v_plan.period_days), now())
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id    = EXCLUDED.plan_id,
    status     = 'active',
    source     = EXCLUDED.source,
    expires_at = CASE
      WHEN public.entitlements.expires_at IS NOT NULL
       AND public.entitlements.expires_at > now()
      THEN public.entitlements.expires_at + make_interval(days => v_plan.period_days)
      ELSE EXCLUDED.expires_at
    END,
    updated_at = now();

  SELECT expires_at INTO v_expires FROM public.entitlements WHERE user_id = v_order.user_id;

  RETURN jsonb_build_object(
    'ok',         true,
    'order_id',   v_order.id,
    'user_id',    v_order.user_id,
    'plan_id',    v_plan.id,
    'plan_name',  v_plan.name,
    'expires_at', to_char(v_expires, 'YYYY-MM-DD HH24:MI:SS TZ')
  );
END;
$$;
