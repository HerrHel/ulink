-- refund_daily_feature_quota：失败请求退回每日次数
--
-- 背景（2026-11-11 排查）：
--   mimo-chat 在请求进入时先 consume_daily_feature_quota('ai.requests.daily')，
--   但上游 5xx/超时、音频物化失败等由服务端原因导致的失败不会退还该计数，
--   free 用户只有 20 次/日，服务端故障会持续消耗用户额度。
--
-- 语义：
--   - 只对白名单 feature 生效（与 consume_daily_feature_quota 一致）；
--   - key 口径必须与 consume 完全一致：feature:<feature>:<uid>:<UTC+8 日期>；
--   - count 已为 0 时返回 false（无消耗可退）。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

BEGIN;

CREATE OR REPLACE FUNCTION public.refund_daily_feature_quota(
  p_uid     text,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_key     text;
  v_updated integer;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0
     OR p_feature NOT IN ('ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily', 'ai.requests.daily') THEN
    RETURN false;
  END IF;

  v_key := 'feature:' || p_feature || ':' || p_uid || ':' ||
           to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD');

  UPDATE private.rate_limit_counters
     SET count = GREATEST(count - 1, 0)
   WHERE key = v_key AND count > 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_daily_feature_quota(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_daily_feature_quota(text, text) TO service_role;

COMMENT ON FUNCTION public.refund_daily_feature_quota(text, text) IS
  '仅 service_role：失败请求退回一次每日 feature 配额（key 口径与 consume_daily_feature_quota 一致）。';

COMMIT;
