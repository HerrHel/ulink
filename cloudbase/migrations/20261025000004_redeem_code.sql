-- 兑换码通道：无需支付商户号即可跑通「下单 → 发货 → 权益生效」全链路
--
-- 为什么先做这个：
-- 1) 支付系统不是"接入"，是从零开发（下单、渠道回调验签、幂等发货、退款），
--    且依赖商户号（个体户可开，但需材料与审核）；
-- 2) 兑换码通道把**除"钱从哪来"之外**的所有环节都提前跑通并验证：
--    订单表 → 幂等核销 → 权益发放 → 额度生效 → 降级；
-- 3) 将来接微信/支付宝时，只需再加一个"渠道回调写 orders"的入口，
--    权益发放逻辑完全复用（同一个 redeem/fulfill 语义）。
--
-- 设计要点：
-- - 兑换码本身就是 orders.idempotency_key（不另建表），天然唯一、幂等；
-- - 核销用「条件 UPDATE + ROW_COUNT」判定，只有一个用户能拿到；
-- - 兑换码只允许核销一次（status: pending → paid）；
-- - 权益期限可叠加（续费场景：未到期则从原到期日继续加），到期则从现在起算；
-- - 只授予 service_role：客户端不能直接调用，必须经云函数验签后转发。

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
  '仅 service_role：核销兑换码并发放权益。幂等（同一码只能核销一次）；期限可叠加。';

-- ── 2. 「查我的权益」：仅取调用者自己的，登录用户可调 ──────────────────
-- ⚠️ resolve_entitlement(p_uid) 接受任意 uid，若授予 authenticated，
-- 任何登录用户都能查他人的套餐与到期时间 —— 属于越权读取。
-- 因此拆成两个入口：
--   my_entitlement()      → 内部用 auth.uid()，给前端（authenticated）用
--   resolve_entitlement(p_uid) → 仅 service_role（云函数内部按 uid 解析）
CREATE OR REPLACE FUNCTION public.my_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR length(trim(v_uid)) = 0 THEN
    RETURN jsonb_build_object('plan_id', 'free', 'status', 'anonymous', 'features', '{}'::jsonb);
  END IF;
  RETURN public.resolve_entitlement(v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.my_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlement() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_entitlement() IS
  '返回**调用者自己**的权益快照。前端唯一入口；不可传他人 uid。';

-- 收紧：resolve_entitlement 只留服务端可用
REVOKE ALL ON FUNCTION public.resolve_entitlement(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_entitlement(text) TO service_role;

COMMIT;
