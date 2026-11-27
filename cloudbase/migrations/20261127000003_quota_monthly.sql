-- 每日额度按账号时区计数 + PRO 每月 3000 次主限额（2026-11-27，第 2 批 / 共 3 批）
--
-- 依赖第 1 批 20261127000002（_quota_today / _quota_month）。完整背景见 20261127000002 文件头。
-- consume_daily_feature_quota / refund_daily_feature_quota 日期键改为账号时区；
-- ai.requests.daily 放行后再扣每月键 ai.requests.monthly，月度不足退还单日并返回 scope=monthly。
-- 白名单与 20261127000001 一致（含 linkcheck.daily）。幂等：CREATE OR REPLACE + JSONB 合并。

BEGIN;

-- ── 每日额度：日期键改为账号时区（白名单与 20261127000001 一致） ──
CREATE OR REPLACE FUNCTION public.consume_daily_feature_quota(
  p_uid text, p_feature text, p_key_prefix text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  v_ent jsonb; v_features jsonb; v_limit integer; v_key text; v_ok boolean;
  v_month_limit integer; v_month_key text;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily', 'linkcheck.daily') THEN
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
  v_key := 'feature:' || p_feature || ':' || p_uid || ':' || public._quota_today(p_uid);
  v_ok := public.consume_rate_limit(v_key, v_limit, 90000);
  IF v_ok IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'limited', true, 'limit', v_limit, 'scope', 'daily');
  END IF;

  -- PRO 每月请求次数（ai.requests.monthly）：对外的主限额；每日 ai.requests.daily 只作防滥用上限。
  -- 每月额度不足时退还刚扣的每日次数，保证「被拒的请求不占任何额度」。
  IF p_feature = 'ai.requests.daily' THEN
    v_month_limit := (v_features ->> 'ai.requests.monthly')::int;
    IF v_month_limit IS NOT NULL AND v_month_limit > 0 THEN
      v_month_key := 'feature:ai.requests.monthly:' || p_uid || ':' || public._quota_month(p_uid);
      -- 窗口 32 天：月份键本身决定换月，窗口只需不早于换月过期
      IF public.consume_rate_limit(v_month_key, v_month_limit, 2764800) IS NOT TRUE THEN
        UPDATE private.rate_limit_counters SET count = GREATEST(count - 1, 0)
         WHERE key = v_key AND count > 0;
        -- consume_rate_limit 超额也会 +1：同样退回，月度计数不虚高
        UPDATE private.rate_limit_counters SET count = GREATEST(count - 1, 0)
         WHERE key = v_month_key AND count > v_month_limit;
        RETURN jsonb_build_object('ok', false, 'limited', true, 'limit', v_month_limit, 'scope', 'monthly');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'limited', true, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_daily_feature_quota(p_uid text, p_feature text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public
AS $$
DECLARE v_key text; v_updated integer;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily', 'linkcheck.daily') THEN
    RETURN false;
  END IF;
  v_key := 'feature:' || p_feature || ':' || p_uid || ':' || public._quota_today(p_uid);
  UPDATE private.rate_limit_counters
     SET count = GREATEST(count - 1, 0)
   WHERE key = v_key AND count > 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- 每日 AI 请求同时计入了每月次数：一并退还（与 consume 对称）
  IF v_updated > 0 AND p_feature = 'ai.requests.daily' THEN
    UPDATE private.rate_limit_counters
       SET count = GREATEST(count - 1, 0)
     WHERE key = 'feature:ai.requests.monthly:' || p_uid || ':' || public._quota_month(p_uid)
       AND count > 0;
  END IF;
  RETURN v_updated > 0;
END;
$$;

-- ── 权限 ──
REVOKE ALL ON FUNCTION public.consume_daily_feature_quota(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_daily_feature_quota(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.refund_daily_feature_quota(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_daily_feature_quota(text, text) TO service_role;

-- ── PRO 套餐：每月 3000 次为主限额，每日 300 次为防滥用上限 ──
-- 原「每日 100 次」理论月上限约 3000 次；改为每月 3000 次保证存量订阅权益不缩水，且可随用随取。
-- 成本仍由 ai.tokens.monthly 兜底。只改已配置每日 AI 次数的付费档（测试档等不动）。
UPDATE public.plans
   SET features = features || jsonb_build_object('ai.requests.monthly', 3000, 'ai.requests.daily', 300)
 WHERE id <> 'free'
   AND features ? 'ai.requests.daily';

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
