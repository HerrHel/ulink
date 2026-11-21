-- AI 能力改为 PRO 专属；免费用户改为「终身试用次数」（2026-11-21）
--
-- 背景：
--   1. ai-api（收藏时 AI 预填：extract-metadata / ai-candidates）直连 MiMo，此前只有
--      每分钟限流，不看套餐——免费用户实际可无限使用 AI 预填。
--   2. 免费档原为「每日 20 次 AI 请求 + 每月 5 万 token」，等于永久存在一个够用的
--      免费 AI 档，PRO 缺少可感知的独有价值。
--
-- 新口径：
--   - 免费档：features['ai.trial.total'] = 30 —— 注册后**累计** 30 次 AI 调用（预填、
--     对话、批量整理共用），用完即止，不按日/月重置；移除 free 的 ai.requests.daily
--     与 ai.tokens.monthly 展示键（reserve_quota 对缺键已有 50000 兜底，内部仍有上限）。
--   - PRO：不变（ai.requests.daily 100 / ai.tokens.monthly 20 万），ai-api 预填也计入
--     PRO 的每日请求数，避免 PRO 侧同样无界。
--   - 非 AI 能力（从网页 HTML 读标题 / 图标 / 描述、本地规则分类）始终免费，不计次。
--
-- 幂等：CREATE ... IF NOT EXISTS / CREATE OR REPLACE / JSONB 合并，可重复执行。

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_trial_usage (
  user_id    text PRIMARY KEY,
  used       integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_trial_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_trial_usage FORCE ROW LEVEL SECURITY;
-- 不建任何 policy：只允许下方 SECURITY DEFINER 函数读写，前端无直接访问
REVOKE ALL ON public.ai_trial_usage FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ai_trial_usage IS
  '免费用户 AI 终身试用累计次数（ai.trial.total）。只经 consume_ai_access / refund_ai_trial / my_ai_access 访问。';

-- 是否为有效付费用户：非 free 档、状态未过期/退款、未到期
CREATE OR REPLACE FUNCTION public._is_paid_entitlement(p_ent jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_ent->>'plan_id', 'free') <> 'free'
     AND coalesce(p_ent->>'status', '') NOT IN ('expired', 'refunded', 'anonymous')
     AND (p_ent->>'expires_at' IS NULL OR (p_ent->>'expires_at')::timestamptz > now());
$$;

/**
 * 服务端（ai-api / mimo-chat）每次调用大模型前调用：
 *   PRO   → {ok:true, tier:'pro'}（每日次数由调用方另行用 consume_daily_feature_quota 计）
 *   免费  → 原子地 used+1（不超过上限），{ok, tier:'trial', used, limit}
 */
CREATE OR REPLACE FUNCTION public.consume_ai_access(p_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ent jsonb; v_limit integer; v_used integer;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;
  v_ent := public.resolve_entitlement(p_uid);
  IF public._is_paid_entitlement(v_ent) THEN
    RETURN jsonb_build_object('ok', true, 'tier', 'pro');
  END IF;
  SELECT coalesce((features ->> 'ai.trial.total')::int, 0) INTO v_limit FROM public.plans WHERE id = 'free';
  v_limit := coalesce(v_limit, 0);
  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'tier', 'trial', 'used', 0, 'limit', 0, 'reason', 'trial_exhausted');
  END IF;
  INSERT INTO public.ai_trial_usage AS t (user_id, used, updated_at)
  VALUES (p_uid, 1, now())
  ON CONFLICT (user_id) DO UPDATE
     SET used = t.used + 1, updated_at = now()
   WHERE t.used < v_limit
  RETURNING t.used INTO v_used;
  IF v_used IS NULL THEN
    -- 已达上限：ON CONFLICT 的 WHERE 不成立，无行返回
    RETURN jsonb_build_object('ok', false, 'tier', 'trial', 'used', v_limit, 'limit', v_limit, 'reason', 'trial_exhausted');
  END IF;
  RETURN jsonb_build_object('ok', true, 'tier', 'trial', 'used', v_used, 'limit', v_limit);
END;
$$;

/** 上游失败（5xx / 超时 / 解析失败）时退还 1 次试用，不让用户为服务端故障买单 */
CREATE OR REPLACE FUNCTION public.refund_ai_trial(p_uid text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ai_trial_usage SET used = used - 1, updated_at = now()
   WHERE user_id = p_uid AND used > 0;
$$;

/** 前端查询**自己**的 AI 可用状态（不可传他人 uid） */
CREATE OR REPLACE FUNCTION public.my_ai_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid text; v_ent jsonb; v_limit integer; v_used integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR length(trim(v_uid)) = 0 THEN
    RETURN jsonb_build_object('tier', 'anonymous', 'used', 0, 'limit', 0, 'remaining', 0);
  END IF;
  v_ent := public.resolve_entitlement(v_uid);
  IF public._is_paid_entitlement(v_ent) THEN
    RETURN jsonb_build_object('tier', 'pro');
  END IF;
  SELECT coalesce((features ->> 'ai.trial.total')::int, 0) INTO v_limit FROM public.plans WHERE id = 'free';
  SELECT used INTO v_used FROM public.ai_trial_usage WHERE user_id = v_uid;
  v_limit := coalesce(v_limit, 0);
  v_used := coalesce(v_used, 0);
  RETURN jsonb_build_object('tier', 'trial', 'used', v_used, 'limit', v_limit,
                            'remaining', greatest(v_limit - v_used, 0));
END;
$$;

REVOKE ALL ON FUNCTION public._is_paid_entitlement(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_access(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ai_trial(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._is_paid_entitlement(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_access(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_ai_trial(text) TO service_role;
REVOKE ALL ON FUNCTION public.my_ai_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ai_access() TO authenticated, service_role;

-- 免费档：加终身试用键，撤下按日/按月的 AI 展示键
UPDATE public.plans
   SET features = (COALESCE(features, '{}'::jsonb) - 'ai.requests.daily' - 'ai.tokens.monthly')
                  || jsonb_build_object('ai.trial.total', 30)
 WHERE id = 'free';

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
