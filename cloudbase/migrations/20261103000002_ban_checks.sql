-- 三个分享/付费入口 RPC 加封禁校验（PERFORM fn_assert_not_banned）
-- 定义基于线上 pg_get_functiondef 导出（2026-11-03），仅在函数体校验段
-- 之后插入一行封禁检查，其余逐字保留。

-- ── 1. 分类分享开启 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_public_category_share(p_category_id text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
  v_id text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  -- 封禁校验：被封禁账号不得开启新的公开分享
  PERFORM public.fn_assert_not_banned(v_uid);
  IF p_category_id IS NULL OR length(trim(p_category_id)) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public_category_shares (id, user_id, category_id)
  VALUES ('cat_' || substring(gen_random_uuid()::text FROM 1 FOR 20), v_uid, p_category_id)
  ON CONFLICT (user_id, category_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── 2. 分享访问密码设置 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_share_password(p_gid text, p_user_id text, p_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_gid IS NULL OR length(trim(p_gid)) = 0 THEN
    RETURN false;
  END IF;
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN false;
  END IF;
  -- 封禁校验：被封禁账号不得变更分享配置
  PERFORM public.fn_assert_not_banned(p_user_id);

  UPDATE sibling_groups
     SET share_password_hash = NULLIF(trim(COALESCE(p_hash, '')), ''),
         updated_at = now()
   WHERE id = p_gid
     AND user_id = p_user_id
     AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

-- ── 3. 支付下单 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment_order(p_uid text, p_plan_id text, p_channel text, p_ttl_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 封禁校验：被封禁账号不得下单
  PERFORM public.fn_assert_not_banned(p_uid);
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
$function$;

-- 保持原有执行权限（依据线上 role_routine_grants 逐函数核对）：
-- * create_payment_order / set_share_password：仅 service_role
--   （pay / share-admin 云函数代调，客户端不直连）
-- * upsert_public_category_share：anon + authenticated（客户端直调）
--   + service_role
GRANT EXECUTE ON FUNCTION public.create_payment_order(text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_share_password(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_public_category_share(text) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
