-- 2026-11-09：ai_quota_check 改为「登录用户只能查自己」
--
-- 上一条迁移（005）把 ai_quota_check 的 anon/authenticated 全部收回，但
-- SettingsPanel.vue:1442 会以登录用户身份直接调它展示 AI 额度进度条。
-- 因此改为：恢复 authenticated 的 EXECUTE，函数内用 auth.uid() 做归属校验：
--   · 浏览器登录用户：auth.uid() = 自己的 sub，p_uid 必须是本人，否则返回 forbidden；
--   · 云函数（service_role）：auth.uid() 为 NULL，跳过校验（服务端可信）。
-- 这样既保留前端功能，又消除「知道他人 19 位 uid 就能查其套餐/用量」的越权读。

BEGIN;

GRANT EXECUTE ON FUNCTION public.ai_quota_check(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_quota_check(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    text;
  v_ent       jsonb;
  v_status    text;
  v_free_lim  numeric;
  v_limit     numeric;
  v_used      numeric;
  v_plan_id   text;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('plan_id', 'free', 'status', 'invalid',
      'limit_tokens', 0, 'used_tokens', 0, 'remaining', 0, 'exceeded', true);
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND p_uid IS DISTINCT FROM v_caller THEN
    RETURN jsonb_build_object('plan_id', 'free', 'status', 'forbidden',
      'limit_tokens', 0, 'used_tokens', 0, 'remaining', 0, 'exceeded', true);
  END IF;

  v_ent := public.resolve_entitlement(p_uid);
  v_status := coalesce(v_ent ->> 'status', 'active');

  IF v_status IN ('expired', 'refunded') THEN
    SELECT coalesce((features ->> 'ai.tokens.monthly')::numeric, 50000)
      INTO v_free_lim
      FROM public.plans WHERE id = 'free';
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

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
