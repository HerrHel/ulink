-- 线上热修：reserve_quota 把参数 p_period 误写成裸列名 period
--
-- 2026-11-14 第二轮审计（#1）：本函数最终版（20261110000005）的
--   INSERT ... VALUES (p_uid, p_metric, p_amount, p_ref, period, 'reserve')
-- 里 `period` 既不是参数也不是 DECLARE 变量，PostgreSQL 在 VALUES 中解析为
-- 列引用会报 42703 → 每次预扣失败；mimo-chat 对该错误 fail-open，月度 token
-- 配额形同虚设。
--
-- 线上复核（只读）：
--   SELECT proname, prosrc LIKE '%p_ref, period,%' FROM pg_proc
--     → reserve_quota = true
--   SELECT count(*) FROM public.usage_ledger → 0   （账本「只增不改」）
--
-- 本文件是从 20261110000005 抄来的完整函数，仅把 VALUES 里的 period 改回
-- p_period，CREATE OR REPLACE 幂等，可安全重复执行。其余语义（过期回落免费档、
-- advisory lock 并发串行、返回结构）一律不变。

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
  VALUES (p_uid, p_metric, p_amount, p_ref, p_period, 'reserve');

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_amount, 'limit', v_limit);
END;
$$;
