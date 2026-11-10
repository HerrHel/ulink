-- 2026-11-10：审计上报再加「每日上限 + action 字符集」约束
--
-- 20261110000003 已把单次 detail 限制到 4KB、每分钟 10 次；但按分钟限流仍允许
-- 单账号每天写入约 1.4 万条记录。审计表是合规举证材料，客户端可控写入必须有
-- 明确的日上限，避免被单个账号长期刷量。
--
-- 本次追加：
--   1) action 只允许 [a-zA-Z0-9_.:-]（前端实际值为 login / login_password /
--      password_reset），拒绝空白、控制字符与任意文本；
--   2) 每用户每日 200 条硬上限（UTC+8 自然日），与每分钟 10 次叠加生效。
--
-- 幂等：CREATE OR REPLACE / REVOKE / GRANT 均可重复执行。

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_log_event(
  p_action      text,
  p_object_type text DEFAULT NULL,
  p_object_id   text DEFAULT NULL,
  p_detail      jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     text := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;  -- 未登录一律拒绝
  END IF;
  IF p_action IS NULL OR length(btrim(p_action)) = 0 OR length(p_action) > 64 THEN
    RETURN false;
  END IF;
  -- 只允许结构化事件名，拒绝空白/控制字符/任意文本
  IF p_action !~ '^[a-zA-Z0-9_.:-]+$' THEN
    RETURN false;
  END IF;
  -- 客户端可控 detail 必须有体积上限，防超大 JSONB 刷爆审计表
  IF p_detail IS NOT NULL AND pg_column_size(p_detail) > 4096 THEN
    RETURN false;
  END IF;
  -- 每分钟 10 次（防突发）
  v_allowed := public.consume_rate_limit('audit:uid:' || v_uid, 10, 60);
  IF v_allowed IS NOT TRUE THEN
    RETURN false;
  END IF;
  -- 每日 200 次（防长期刷量；UTC+8 自然日）
  v_allowed := public.consume_rate_limit(
    'audit:uid:' || v_uid || ':' || to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
    200,
    90000
  );
  IF v_allowed IS NOT TRUE THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_log (uid, action, object_type, object_id, detail)
  VALUES (v_uid, left(btrim(p_action), 64), left(coalesce(p_object_type, ''), 32),
          left(coalesce(p_object_id, ''), 128), p_detail);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_event(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_event(text, text, text, jsonb) TO authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
