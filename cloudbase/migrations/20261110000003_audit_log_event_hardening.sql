-- 2026-11-10：客户端审计上报入口加固
--
-- 背景：audit_log_event 是登录用户可直接调用的 SECURITY DEFINER 函数（前端登录埋点）。
-- 原实现只限制 action 长度，p_detail 无体积上限、整函数无频率上限：
--   · 登录用户可反复写入超大 JSONB，刷爆 audit_log（存储/成本 DoS）；
--   · 也可高频伪造任意 action，污染合规审计记录。
--
-- 修法（不改变前端调用方式）：
--   1) p_detail 超过 4KB 直接拒绝；
--   2) 每用户 10 次/分钟（复用 consume_rate_limit，函数以 owner 身份执行，
--      不受 20261110000002 收回 authenticated 执行权的影响）；
--   3) action/object_type/object_id 的既有截断与校验保持不变。
--
-- 幂等：CREATE OR REPLACE。

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
  -- 客户端可控 detail 必须有体积上限，防超大 JSONB 刷爆审计表
  IF p_detail IS NOT NULL AND pg_column_size(p_detail) > 4096 THEN
    RETURN false;
  END IF;
  -- 每用户 10 次/分钟：登录埋点足够，同时给审计日志刷量设硬上限
  v_allowed := public.consume_rate_limit('audit:uid:' || v_uid, 10, 60);
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
