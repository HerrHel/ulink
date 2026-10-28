-- ─────────────────────────────────────────────────────────────────────
-- 20261028000010_payment_flow.sql
--
-- 支付流程数据层：订单生命周期 + 原子发货。
--
-- 设计约束（来自 docs/BILLING_DESIGN.md 与 20261025000002_billing_core.sql）：
--   1. `orders` 已有 channel / channel_order_id / status / idempotency_key(UNIQUE) /
--      raw_callback，本迁移**只补支付需要的字段**，不改既有语义；
--   2. 发货必须**原子且幂等**：渠道回调会重发（微信最多 8 次，间隔递增），
--      重复回调绝不能重复延长权益 —— 靠 `status='pending'` 条件更新兜住；
--   3. 金额必须由**服务端订单**决定，回调金额只做校验（不符即拒绝），
--      绝不用回调里的金额去写库（防篡改）；
--   4. 全部函数 SECURITY DEFINER + 固定 search_path，只 GRANT 给 service_role，
--      anon/authenticated 一律不可执行（客户端只能通过云函数间接调用）。
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. 订单补充字段 ──────────────────────────────────────────────────

ALTER TABLE public.orders
  -- 待支付订单的过期时间（超时后由维护任务或首次查询时标记 failed）
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,
  -- 渠道侧的“预支付”句柄：微信 code_url / 支付宝 qr_code，供前端展示二维码
  ADD COLUMN IF NOT EXISTS pay_payload     JSONB,
  -- 退款留痕（金额独立记录，便于对账；状态机见 billing_refund）
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_cents  INTEGER NOT NULL DEFAULT 0
    CHECK (refunded_cents >= 0),
  -- 渠道回调到达时间（与 paid_at 区分：paid_at 是发货时刻，可能晚于回调）
  ADD COLUMN IF NOT EXISTS notified_at     TIMESTAMPTZ;

-- 幂等键已 UNIQUE；这里补支付查询常用的组合索引
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON public.orders (status, created_at DESC);

COMMENT ON COLUMN public.orders.expires_at IS
  '待支付订单过期时间；过期后不允许再发货，由 maintenance 或查询入口标记 failed。';
COMMENT ON COLUMN public.orders.pay_payload IS
  '渠道预支付句柄（微信 code_url / 支付宝 qr_code 等），仅服务端写入，前端只读取展示。';
COMMENT ON COLUMN public.orders.refunded_cents IS
  '已退款金额（分）；<= amount_cents。部分退款也有意义，故不做全额约束。';

-- ── 2. 创建待支付订单（服务端定价，客户端不可传价格）────────────────

CREATE OR REPLACE FUNCTION public.create_payment_order(
  p_uid         text,
  p_plan_id     text,
  p_channel     text,
  p_ttl_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan   public.plans%ROWTYPE;
  v_order  public.orders%ROWTYPE;
  -- 微信 out_trade_no 限 6-32 位字母数字（连字符也超长），
  -- 订单 id 直接用 32 位无连字符 UUID，保证「微信侧订单号 = 库内 id」回调对账一致
  v_id     text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_user');
  END IF;
  IF p_channel NOT IN ('wechat', 'alipay') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_channel');
  END IF;
  IF coalesce(p_ttl_minutes, 30) < 5 OR coalesce(p_ttl_minutes, 30) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ttl');
  END IF;

  -- 价格唯一起源：服务端 plans 表。客户端传任何金额都不采信。
  SELECT * INTO v_plan
    FROM public.plans
   WHERE id = p_plan_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;
  IF v_plan.price_cents IS NULL OR v_plan.price_cents <= 0 THEN
    -- 免费套餐不该走支付（免费档由 resolve_entitlement 默认返回）
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_payable');
  END IF;

  INSERT INTO public.orders
    (id, user_id, plan_id, amount_cents, currency, channel, status,
     idempotency_key, expires_at)
  VALUES
    (v_id, p_uid, v_plan.id, v_plan.price_cents, coalesce(v_plan.currency, 'CNY'),
     p_channel, 'pending',
     -- 幂等键用订单 id：同一订单在渠道侧天然唯一；渠道重发回调靠 status 兜幂等
     v_id,
     now() + make_interval(mins => coalesce(p_ttl_minutes, 30)))
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'ok',            true,
    'order_id',      v_order.id,
    'plan_id',       v_plan.id,
    'plan_name',     v_plan.name,
    'amount_cents',  v_order.amount_cents,
    'currency',      v_order.currency,
    'channel',       v_order.channel,
    'expires_at',    to_char(v_order.expires_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
END;
$$;

COMMENT ON FUNCTION public.create_payment_order(text, text, text, integer) IS
  '创建待支付订单。金额**只取 plans.price_cents**，客户端传的价格一律不采信。';

-- ── 3. 写入渠道预支付句柄（二维码等）────────────────────────────────

CREATE OR REPLACE FUNCTION public.attach_pay_payload(
  p_order_id text,
  p_payload  jsonb,
  p_channel_order_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.orders
     SET pay_payload      = p_payload,
         channel_order_id = coalesce(p_channel_order_id, channel_order_id)
   WHERE id = p_order_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_updated > 0);
END;
$$;

-- ── 4. 支付成功发货（**幂等 + 金额校验**）───────────────────────────

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
  IF p_paid_cents IS NOT NULL AND p_paid_cents <> v_order.amount_cents THEN
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
    (v_order.user_id, v_plan.id, 'active', p_channel, now(),
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

COMMENT ON FUNCTION public.settle_paid_order(text, text, text, integer, jsonb) IS
  '渠道支付成功发货。幂等靠 status=pending 条件更新；金额只校验不采信；过期订单不发货。';

-- ── 5. 订单置为失败（主动查单发现未支付/已关闭）─────────────────────

CREATE OR REPLACE FUNCTION public.fail_payment_order(p_order_id text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.orders
     SET status = 'failed',
         raw_callback = coalesce(raw_callback, '{}'::jsonb)
                          || jsonb_build_object('fail_reason', coalesce(p_reason, 'unknown'))
   WHERE id = p_order_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_updated > 0);
END;
$$;

-- ── 6. 退款留痕（只记状态，实际退款由云函数调渠道 API）──────────────

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
  v_order   public.orders%ROWTYPE;
  v_updated integer;
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

  UPDATE public.orders
     SET status          = CASE WHEN p_cents >= amount_cents THEN 'refunded' ELSE status END,
         refunded_cents  = refunded_cents + p_cents,
         refunded_at     = now(),
         raw_callback    = coalesce(raw_callback, '{}'::jsonb)
                             || jsonb_build_object('refund', p_raw)
   WHERE id = p_order_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', v_updated > 0, 'refunded_cents', v_order.refunded_cents + p_cents);
END;
$$;

COMMENT ON FUNCTION public.mark_order_refunded(text, integer, jsonb) IS
  '退款留痕。仅改本地状态；真正的退款请求由云函数调渠道 API 发起并校验结果后再调本函数。';

-- ── 7. 权限收紧：全部只给 service_role ─────────────────────────────

REVOKE ALL ON FUNCTION public.create_payment_order(text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_pay_payload(text, jsonb, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_paid_order(text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payment_order(text, text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_order_refunded(text, integer, jsonb)      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_payment_order(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_pay_payload(text, jsonb, text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_paid_order(text, text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_payment_order(text, text)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_refunded(text, integer, jsonb)      TO service_role;

-- ── 8. 前端只读入口（PostgREST 角色 42501 的解法）──────────────────
-- pay 云函数里曾用 rdb.from('plans').where(...) 直接查，但 rdb 是 PostgREST 客户端，
-- 数据库角色对 plans/orders 无 SELECT 权限（42501 permission denied）。
-- 与 redeem 模式对齐：SECURITY DEFINER 函数 + service_role 调用，不放宽 RLS。

CREATE OR REPLACE FUNCTION public.list_purchase_plans()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.plans%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- 只返回启用且付费的套餐；价格唯一起源仍是本表
  FOR v_row IN
    SELECT * FROM public.plans WHERE active = true AND price_cents > 0 ORDER BY price_cents ASC
  LOOP
    v_result := v_result || jsonb_build_object(
      'planId',     v_row.id,
      'name',       v_row.name,
      'priceCents', v_row.price_cents,
      'currency',   coalesce(v_row.currency, 'CNY'),
      'periodDays', v_row.period_days
    );
  END LOOP;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.list_purchase_plans() IS
  '可购套餐列表（SECURITY DEFINER）。前端 PurchaseModal 的数据源，价格不硬编码。';

CREATE OR REPLACE FUNCTION public.get_payment_order(p_order_id text, p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  -- 归一化：不存在与"不是你的"都返回 not_found，避免订单号探测
  IF NOT FOUND OR v_order.user_id <> p_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'orderId',    v_order.id,
      'planId',     v_order.plan_id,
      'amountCents',v_order.amount_cents,
      'currency',   v_order.currency,
      'channel',    v_order.channel,
      'status',     v_order.status,
      'qrCode',     v_order.pay_payload ->> 'qrCode',
      'paidAt',     v_order.paid_at,
      'expiresAt',  v_order.expires_at,
      'createdAt',  v_order.created_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_payment_order(text, text) IS
  '按订单号+uid 查订单（SECURITY DEFINER 内部校验归属）。云函数 status action 用。';

REVOKE ALL ON FUNCTION public.list_purchase_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_payment_order(text, text) FROM PUBLIC;
-- ⚠️ 必须 GRANT anon + authenticated：云函数 node-sdk 的 rdb 走 tcbopenapi 身份，
-- 映射到的 DB 角色是 anon/authenticated 而非 service_role —— 只 GRANT service_role
-- 会在云端收到 42501 permission denied（本地管理员身份直查是通的，掩盖了这点）。
-- 安全性不依赖 EXECUTE 权限：两函数均 SECURITY DEFINER 且内部做归属/状态校验。
GRANT EXECUTE ON FUNCTION public.list_purchase_plans() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_order(text, text) TO anon, authenticated, service_role;
