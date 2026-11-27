-- 每日 / 每月额度按「账号时区」的 0 点刷新（2026-11-27，第 1 批 / 共 3 批）
--
-- 每个账号绑定一个 IANA 时区（public.user_quota_tz，首次登录由浏览器自动上报），额度按该时区 0 点刷新；
-- 未登记沿用 Asia/Shanghai（与旧行为一致）。防钻空子：改时区只登记 pending，到当前时区下一个 0 点生效
-- （当天用量照算）；手动修改 30 天一次（首次上报不计）；首次上报若当天已有用量同样延后生效。
-- 本批只新增对象（表、工具函数、set_my_timezone），不改变现有行为；
-- 第 2 批 20261127000003 切换计数口径并启用 PRO 每月次数，第 3 批 20261127000004 更新 my_ai_access。
-- 分批原因：tcb db execute 单批 ≤10KB。完整说明见 docs/QUOTA_ENFORCEMENT.md。
-- 幂等：CREATE ... IF NOT EXISTS / CREATE OR REPLACE / REVOKE+GRANT。

BEGIN;

-- ── 表 ──
CREATE TABLE IF NOT EXISTS public.user_quota_tz (
  user_id              text PRIMARY KEY,
  tz                   text NOT NULL,
  pending_tz           text,
  pending_effective_at timestamptz,
  -- 最近一次**手动**修改时间（冷却期依据）；首次自动上报为 NULL
  changed_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_quota_tz ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quota_tz FORCE ROW LEVEL SECURITY;
-- 不建 policy：只经下方 SECURITY DEFINER 函数读写
REVOKE ALL ON public.user_quota_tz FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.user_quota_tz IS
  '账号额度时区：每日额度按该时区 0 点刷新。改时区到当前时区下一个 0 点才生效、手动修改 30 天一次。只经 set_my_timezone / my_ai_access / _quota_today 访问。';

-- ── 工具函数 ──
/** 账号当前生效的额度时区（pending 到点即生效，读时计算，无需写回）；未登记 = Asia/Shanghai */
CREATE OR REPLACE FUNCTION public._effective_quota_tz(p_uid text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT CASE WHEN q.pending_tz IS NOT NULL AND q.pending_effective_at <= now()
                 THEN q.pending_tz ELSE q.tz END
       FROM public.user_quota_tz q WHERE q.user_id = p_uid),
    'Asia/Shanghai');
$$;

/** 账号时区下的「今天」（YYYY-MM-DD），每日额度日期键的唯一来源 */
CREATE OR REPLACE FUNCTION public._quota_today(p_uid text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT to_char(now() AT TIME ZONE public._effective_quota_tz(p_uid), 'YYYY-MM-DD');
$$;

/** 账号时区下的「本月」（YYYY-MM），PRO 每月请求次数键的唯一来源 */
CREATE OR REPLACE FUNCTION public._quota_month(p_uid text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT to_char(now() AT TIME ZONE public._effective_quota_tz(p_uid), 'YYYY-MM');
$$;

/** 指定时区的下个月 1 日 0 点（绝对时刻） */
CREATE OR REPLACE FUNCTION public._next_local_month_start(p_tz text)
RETURNS timestamptz LANGUAGE sql STABLE
AS $$
  SELECT (date_trunc('month', now() AT TIME ZONE p_tz) + interval '1 month') AT TIME ZONE p_tz;
$$;

/** 指定时区的下一个 0 点（绝对时刻） */
CREATE OR REPLACE FUNCTION public._next_local_midnight(p_tz text)
RETURNS timestamptz LANGUAGE sql STABLE
AS $$
  SELECT (date_trunc('day', now() AT TIME ZONE p_tz) + interval '1 day') AT TIME ZONE p_tz;
$$;

/** 账号时区状态（my_ai_access / set_my_timezone 共用返回片段） */
CREATE OR REPLACE FUNCTION public._quota_tz_state(p_uid text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE q public.user_quota_tz%ROWTYPE; v_found boolean; v_eff text; v_pending text; v_pending_at timestamptz;
BEGIN
  SELECT * INTO q FROM public.user_quota_tz WHERE user_id = p_uid;
  v_found := FOUND;  -- 立即保存：后续语句可能改写 FOUND
  v_eff := public._effective_quota_tz(p_uid);
  IF v_found AND q.pending_tz IS NOT NULL AND q.pending_effective_at > now() THEN
    v_pending := q.pending_tz; v_pending_at := q.pending_effective_at;
  END IF;
  RETURN jsonb_build_object(
    'quota_tz', v_eff,
    'quota_tz_set', v_found,
    'pending_tz', v_pending,
    'pending_effective_at', v_pending_at,
    'tz_changed_at', CASE WHEN v_found THEN q.changed_at END,
    'daily_resets_at', public._next_local_midnight(v_eff)
  );
END;
$$;

/** 今天（账号时区）是否已有任何每日额度用量：首次上报时决定能否立即生效 */
CREATE OR REPLACE FUNCTION public._has_daily_usage_today(p_uid text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.rate_limit_counters r
     WHERE r.key IN (
       SELECT 'feature:' || f || ':' || p_uid || ':' || public._quota_today(p_uid)
         FROM unnest(ARRAY['ai.tokens.monthly', 'video.deep.daily', 'video.extract.daily',
                           'ai.requests.daily', 'linkcheck.daily']) AS f)
       AND r.count > 0);
$$;

-- ── 设置时区 ──
/**
 * 登录用户设置自己的额度时区。
 *   p_initial = true：首次自动上报；已登记过则什么都不做（多设备不会互相改写）。
 *   p_initial = false：手动修改；30 天冷却，到当前时区下一个 0 点生效。
 *     改回当前生效时区 = 撤销待生效的修改（不占冷却）。
 * 返回 {ok, reason?, next_allowed_at?, ...时区状态}
 */
CREATE OR REPLACE FUNCTION public.set_my_timezone(p_tz text, p_initial boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid text; q public.user_quota_tz%ROWTYPE; v_found boolean; v_eff text;
  v_cooldown interval := interval '30 days';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR length(trim(v_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'login_required');
  END IF;
  IF p_tz IS NULL OR length(p_tz) > 64
     OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_tz');
  END IF;

  SELECT * INTO q FROM public.user_quota_tz WHERE user_id = v_uid FOR UPDATE;
  v_found := FOUND;

  -- 首次登记
  IF NOT v_found THEN
    IF public._has_daily_usage_today(v_uid) AND p_tz <> 'Asia/Shanghai' THEN
      -- 今天（按默认北京时间）已有用量：到北京时间下一个 0 点才切换，防止首次上报借换天多拿额度
      INSERT INTO public.user_quota_tz (user_id, tz, pending_tz, pending_effective_at, changed_at)
      VALUES (v_uid, 'Asia/Shanghai', p_tz, public._next_local_midnight('Asia/Shanghai'),
              CASE WHEN p_initial THEN NULL ELSE now() END);
    ELSE
      INSERT INTO public.user_quota_tz (user_id, tz, changed_at)
      VALUES (v_uid, p_tz, CASE WHEN p_initial THEN NULL ELSE now() END);
    END IF;
    RETURN jsonb_build_object('ok', true) || public._quota_tz_state(v_uid);
  END IF;

  IF p_initial THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_set') || public._quota_tz_state(v_uid);
  END IF;

  -- 到点的 pending 先落为正式时区
  IF q.pending_tz IS NOT NULL AND q.pending_effective_at <= now() THEN
    UPDATE public.user_quota_tz
       SET tz = q.pending_tz, pending_tz = NULL, pending_effective_at = NULL, updated_at = now()
     WHERE user_id = v_uid;
    q.tz := q.pending_tz; q.pending_tz := NULL; q.pending_effective_at := NULL;
  END IF;
  v_eff := q.tz;

  IF p_tz = v_eff THEN
    -- 改回当前生效时区：撤销待生效修改（不占冷却）
    IF q.pending_tz IS NOT NULL THEN
      UPDATE public.user_quota_tz
         SET pending_tz = NULL, pending_effective_at = NULL, updated_at = now()
       WHERE user_id = v_uid;
    END IF;
    RETURN jsonb_build_object('ok', true) || public._quota_tz_state(v_uid);
  END IF;

  IF q.pending_tz = p_tz THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_pending') || public._quota_tz_state(v_uid);
  END IF;

  IF q.changed_at IS NOT NULL AND q.changed_at > now() - v_cooldown THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown',
                              'next_allowed_at', q.changed_at + v_cooldown)
           || public._quota_tz_state(v_uid);
  END IF;

  UPDATE public.user_quota_tz
     SET pending_tz = p_tz,
         pending_effective_at = public._next_local_midnight(v_eff),
         changed_at = now(),
         updated_at = now()
   WHERE user_id = v_uid;
  RETURN jsonb_build_object('ok', true) || public._quota_tz_state(v_uid);
END;
$$;

-- ── 权限 ──
REVOKE ALL ON FUNCTION public._effective_quota_tz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quota_today(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._next_local_midnight(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quota_tz_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._has_daily_usage_today(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quota_month(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._next_local_month_start(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._quota_month(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._next_local_month_start(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._effective_quota_tz(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._quota_today(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._next_local_midnight(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._quota_tz_state(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._has_daily_usage_today(text) TO service_role;

REVOKE ALL ON FUNCTION public.set_my_timezone(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_timezone(text, boolean) TO authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
