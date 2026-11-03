-- 审计日志与账号封禁：兑现《安全评估自评估报告》中的承诺
-- （操作日志留存、内容处置台账、按 IP/账号维度检索、限制功能与封禁账号）
--
-- 设计要点：
-- * audit_log 不向 anon/authenticated 开放任何直接访问，写入只经
--   SECURITY DEFINER 函数（fn_audit_write / audit_log_event / 触发器），
--   保证记录不可被客户端篡改或删除；
-- * 关键业务事件用**数据库触发器**捕获（orders 建单/状态变更、
--   sibling_groups 分享开关与分享密码变更、user_security 封禁变更），
--   无论写入来自 PostgREST、云函数还是 RPC，都会被记录；
-- * audit_log_event 供客户端在登录成功等场景上报，SECURITY DEFINER
--   内部取 auth.uid()，未登录调用直接拒绝；
-- * user_security.banned_until + fn_assert_not_banned 提供「限制功能/
--   封禁账号」的最小实现：封禁后不能创建订单、不能开启分享；
--   数据读取与导出保留（用户仍可取回自己的数据，符合处置比例）。

-- ── 1. 审计日志表 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  uid         text,
  action      text NOT NULL,
  object_type text,
  object_id   text,
  ip_hash     text,
  detail      jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_uid_created ON public.audit_log (uid, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON public.audit_log (action, created_at);

-- 客户端零访问：不建 RLS 策略即默认拒绝（anon/authenticated 无 GRANT），
-- 读取与维护走管理员连接（tcb db execute / 控制台）。
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;

-- ── 2. 统一写入函数（云函数经 service_role 调用，如举报处置台账）──
CREATE OR REPLACE FUNCTION public.fn_audit_write(
  p_action      text,
  p_uid         text DEFAULT NULL,
  p_object_type text DEFAULT NULL,
  p_object_id   text DEFAULT NULL,
  p_ip_hash     text DEFAULT NULL,
  p_detail      jsonb DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_action IS NULL OR length(btrim(p_action)) = 0 THEN
    RAISE EXCEPTION 'audit_action_required';
  END IF;

  INSERT INTO public.audit_log (uid, action, object_type, object_id, ip_hash, detail)
  VALUES (p_uid, left(btrim(p_action), 64), left(coalesce(p_object_type, ''), 32),
          left(coalesce(p_object_id, ''), 128), p_ip_hash, p_detail)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_write(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_write(text, text, text, text, text, jsonb)
  TO service_role;

-- ── 3. 客户端上报入口（登录埋点等，仅认证用户、只记录本人事件）────
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
  v_uid text := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;  -- 未登录一律拒绝
  END IF;
  IF p_action IS NULL OR length(btrim(p_action)) = 0 OR length(p_action) > 64 THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_log (uid, action, object_type, object_id, detail)
  VALUES (v_uid, left(btrim(p_action), 64), left(coalesce(p_object_type, ''), 32),
          left(coalesce(p_object_id, ''), 128), p_detail);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_event(text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_event(text, text, text, jsonb)
  TO authenticated, service_role;

-- ── 4. 账号封禁列与校验 ────────────────────────────────────────
ALTER TABLE public.user_security
  ADD COLUMN IF NOT EXISTS banned_until timestamptz;

CREATE OR REPLACE FUNCTION public.fn_assert_not_banned(p_uid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF p_uid IS NULL OR length(btrim(p_uid)) = 0 THEN
    RETURN;
  END IF;
  SELECT max(banned_until) INTO v_until
    FROM public.user_security
   WHERE user_id = p_uid;
  IF v_until IS NOT NULL AND v_until > now() THEN
    RAISE EXCEPTION 'account_banned_until_%', to_char(v_until, 'YYYY-MM-DD HH24:MI');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_assert_not_banned(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assert_not_banned(text) TO authenticated, service_role;

-- 封禁/解封本身也入审计（监管追溯「何时封、何时解」）
CREATE OR REPLACE FUNCTION public.trg_user_security_ban_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.banned_until IS DISTINCT FROM OLD.banned_until THEN
    PERFORM public.fn_audit_write(
      CASE WHEN NEW.banned_until IS NULL THEN 'ban_lift' ELSE 'ban_set' END,
      NEW.user_id, 'account', NEW.id, NULL,
      jsonb_build_object('banned_until', NEW.banned_until));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_user_security_ban ON public.user_security;
CREATE TRIGGER audit_user_security_ban
  AFTER UPDATE OF banned_until ON public.user_security
  FOR EACH ROW EXECUTE FUNCTION public.trg_user_security_ban_audit();

-- ── 5. 订单触发器：建单与状态流转（支付成功、退款）──────────────
CREATE OR REPLACE FUNCTION public.trg_orders_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_audit_write('order_create', NEW.user_id, 'order', NEW.id, NULL,
      jsonb_build_object('plan_id', NEW.plan_id, 'amount_cents', NEW.amount_cents,
                         'currency', NEW.currency, 'channel', NEW.channel,
                         'status', NEW.status));
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at THEN
      PERFORM public.fn_audit_write('order_status', NEW.user_id, 'order', NEW.id, NULL,
        jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status,
                           'refunded_cents', NEW.refunded_cents));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_orders ON public.orders;
CREATE TRIGGER audit_orders
  AFTER INSERT OR UPDATE OF status, refunded_at ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_audit();

-- ── 6. 分享开关触发器：is_public / 分享密码变更 ─────────────────
CREATE OR REPLACE FUNCTION public.trg_share_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    PERFORM public.fn_audit_write(
      CASE WHEN NEW.is_public THEN 'share_on' ELSE 'share_off' END,
      NEW.user_id, 'group', NEW.id, NULL,
      jsonb_build_object('has_password', NEW.share_password_hash IS NOT NULL));
  ELSIF NEW.share_password_hash IS DISTINCT FROM OLD.share_password_hash THEN
    PERFORM public.fn_audit_write('share_password_set', NEW.user_id, 'group', NEW.id, NULL,
      jsonb_build_object('has_password', NEW.share_password_hash IS NOT NULL));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_share_state ON public.sibling_groups;
CREATE TRIGGER audit_share_state
  AFTER UPDATE OF is_public, share_password_hash ON public.sibling_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_share_audit();

SELECT pg_notify('pgrst', 'reload schema');
