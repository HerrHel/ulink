-- my_ai_access 返回额度时区与 PRO 用量（2026-11-27，第 3 批 / 共 3 批）
--
-- 依赖第 1、2 批。所有登录用户新增 quota_tz / pending / daily_resets_at；PRO 新增单日、每月次数与 token 用量（只读）。
-- 免费 / 未登录原有字段不变。幂等：CREATE OR REPLACE。

BEGIN;

-- ── my_ai_access：时区状态 + PRO 用量 ──
CREATE OR REPLACE FUNCTION public.my_ai_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  v_uid text; v_ent jsonb; v_limit integer; v_used integer;
  v_daily_limit integer; v_daily_used integer;
  v_month_limit numeric; v_month_used numeric;
  v_req_month_limit integer; v_req_month_used integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR length(trim(v_uid)) = 0 THEN
    RETURN jsonb_build_object('tier', 'anonymous', 'used', 0, 'limit', 0, 'remaining', 0);
  END IF;
  v_ent := public.resolve_entitlement(v_uid);

  IF public._is_paid_entitlement(v_ent) THEN
    v_daily_limit := coalesce(((v_ent -> 'features') ->> 'ai.requests.daily')::int, 0);
    SELECT r.count INTO v_daily_used
      FROM private.rate_limit_counters r
     WHERE r.key = 'feature:ai.requests.daily:' || v_uid || ':' || public._quota_today(v_uid);
    v_daily_used := coalesce(v_daily_used, 0);
    -- consume_rate_limit 超额时也会 +1：展示不超过上限
    IF v_daily_limit > 0 THEN v_daily_used := least(v_daily_used, v_daily_limit); END IF;

    v_req_month_limit := coalesce(((v_ent -> 'features') ->> 'ai.requests.monthly')::int, 0);
    SELECT r.count INTO v_req_month_used
      FROM private.rate_limit_counters r
     WHERE r.key = 'feature:ai.requests.monthly:' || v_uid || ':' || public._quota_month(v_uid);
    v_req_month_used := coalesce(v_req_month_used, 0);
    IF v_req_month_limit > 0 THEN v_req_month_used := least(v_req_month_used, v_req_month_limit); END IF;

    v_month_limit := coalesce(((v_ent -> 'features') ->> 'ai.tokens.monthly')::numeric, 0);
    SELECT coalesce(sum(amount), 0) / 2 INTO v_month_used
      FROM public.usage_ledger
     WHERE user_id = v_uid
       AND metric = 'ai.chars'
       AND period = to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM');

    RETURN jsonb_build_object(
      'tier', 'pro',
      'daily_used', v_daily_used,
      'daily_limit', v_daily_limit,
      -- 每月请求次数：对外主限额，按账号时区自然月
      'requests_month_used', v_req_month_used,
      'requests_month_limit', v_req_month_limit,
      'requests_month_resets_at', public._next_local_month_start(public._effective_quota_tz(v_uid)),
      'monthly_used_tokens', round(coalesce(v_month_used, 0)),
      'monthly_limit_tokens', v_month_limit,
      -- 月度仍按北京时间自然月（usage_ledger.period 由 mimo-chat 按北京年月写入）
      'monthly_resets_at',
        (date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 month') AT TIME ZONE 'Asia/Shanghai'
    ) || public._quota_tz_state(v_uid);
  END IF;

  SELECT coalesce((features ->> 'ai.trial.total')::int, 0) INTO v_limit FROM public.plans WHERE id = 'free';
  SELECT used INTO v_used FROM public.ai_trial_usage WHERE user_id = v_uid;
  v_limit := coalesce(v_limit, 0);
  v_used := coalesce(v_used, 0);
  RETURN jsonb_build_object('tier', 'trial', 'used', v_used, 'limit', v_limit,
                            'remaining', greatest(v_limit - v_used, 0))
         || public._quota_tz_state(v_uid);
END;
$$;

-- ── 权限 ──
REVOKE ALL ON FUNCTION public.my_ai_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ai_access() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_ai_access() IS
  '查询自己的 AI 可用状态与额度时区：anonymous / trial（终身试用）/ pro（今日次数、本月 token，只读）。';

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
