-- AI 月度额度检查：订阅过期/退款后回落到免费档额度
--
-- 背景（2026-10-31 审计）：
--   resolve_entitlement() 在 expires_at < now() 时返回 status='expired'，但 features
--   仍是**原付费方案**的 features；而 ai_quota_check 只读 features、不看 status，
--   导致「PRO 到期后仍保有 20 万 token/月」——extract-video 有 free 回落，AI 没有，
--   属于计费口径漏洞（TECH_DEBT §零 #6）。
--
-- 语义：
--   - status ∈ ('expired','refunded') → 按 plans.id='free' 的 ai.tokens.monthly 计算，
--     plan_id 一并回落为 'free'（前端展示按 status 降级）；
--   - 其它（active / grace / 无权益的 free）→ 维持原逻辑；
--   - 返回值形状不变：{plan_id,status,limit_tokens,used_tokens,remaining,exceeded}。
--
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.ai_quota_check(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent       jsonb;
  v_status    text;
  v_free_lim  numeric;
  v_limit     numeric;
  v_used      numeric;
  v_plan_id   text;
BEGIN
  v_ent := public.resolve_entitlement(p_uid);
  v_status := coalesce(v_ent ->> 'status', 'active');

  IF v_status IN ('expired', 'refunded') THEN
    -- 过期/已退款：一律按免费档额度，避免到期后继续吃 PRO 额度
    SELECT coalesce((features ->> 'ai.tokens.monthly')::numeric, 50000)
      INTO v_free_lim
      FROM public.plans
     WHERE id = 'free';
    v_limit := coalesce(v_free_lim, 50000);
    v_plan_id := 'free';
  ELSE
    v_limit := coalesce((v_ent -> 'features') ->> 'ai.tokens.monthly', '50000')::numeric;
    v_plan_id := v_ent ->> 'plan_id';
  END IF;

  SELECT coalesce(sum(amount), 0) / 2 INTO v_used
    FROM public.usage_ledger
   WHERE user_id = p_uid
     AND metric = 'ai.chars'
     AND period = to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM');

  RETURN jsonb_build_object(
    'plan_id',      v_plan_id,
    'status',       v_status,
    'limit_tokens', v_limit,
    'used_tokens',  v_used,
    'remaining',    v_limit - v_used,
    'exceeded',     v_used >= v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_quota_check(text) FROM PUBLIC;
-- 云函数 rdb 身份是 anon/authenticated（见 20261028000010 批 8 的教训）
GRANT EXECUTE ON FUNCTION public.ai_quota_check(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ai_quota_check(text) IS
  'AI 月度额度检查 {plan_id,status,limit_tokens,used_tokens,remaining,exceeded}。expired/refunded 回落 free 额度（2026-10-31）。';
