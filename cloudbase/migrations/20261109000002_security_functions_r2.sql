-- 第二轮深审数据库加固 1/3（2026-11-09）：触发器 / 退额度类型 / 配额幂等 / 权限基线
-- ① trg_user_security_ban_audit 引用不存在的 NEW.id，封禁 UPDATE 必抛 42703 并回滚
-- ② deep_quota_refunds.uid 是 UUID，而 CloudBase uid 是 19 位 text → 退额度永久失败
-- ③ settle_quota 幂等只靠无锁 EXISTS，并发时双插冲正行会多减用量、绕过额度
-- ④ 分类分享写 RPC 被额外 GRANT anon，与最小权限基线漂移

BEGIN;

-- ① 封禁审计：user_security 只有 user_id / master_canary / updated_at / banned_until
CREATE OR REPLACE FUNCTION public.trg_user_security_ban_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.banned_until IS DISTINCT FROM OLD.banned_until THEN
    PERFORM public.fn_audit_write(
      CASE WHEN NEW.banned_until IS NULL THEN 'ban_lift' ELSE 'ban_set' END,
      NEW.user_id, 'account', NEW.user_id, NULL,
      jsonb_build_object('banned_until', NEW.banned_until));
  END IF;
  RETURN NEW;
END;
$$;

-- ② uid 全链路按 text（JWT sub 是 19 位 bigint 字符串）
ALTER TABLE private.deep_quota_refunds ALTER COLUMN uid TYPE TEXT USING uid::text;
DROP FUNCTION IF EXISTS public.refund_deep_quota(UUID, TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.refund_deep_quota(
  p_uid TEXT, p_job_id TEXT, p_key TEXT, p_window_secs INTEGER)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = private, public
AS $$
  WITH ins AS (
    INSERT INTO private.deep_quota_refunds (job_id, uid)
    VALUES (p_job_id, p_uid) ON CONFLICT (job_id) DO NOTHING RETURNING 1
  ), upd AS (
    UPDATE private.rate_limit_counters SET count = GREATEST(count - 1, 0)
     WHERE key = p_key AND EXISTS (SELECT 1 FROM ins) RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ins)
$$;
REVOKE ALL ON FUNCTION public.refund_deep_quota(TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_deep_quota(TEXT,TEXT,TEXT,INTEGER) TO service_role;

-- ③ 数据层唯一约束 + 事务级 advisory lock（生产实测无重复 settle 行，可安全建索引）
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_ledger_settle_ref
  ON public.usage_ledger (ref) WHERE kind = 'settle';
CREATE OR REPLACE FUNCTION public.settle_quota(p_ref text, p_actual numeric, p_period text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.usage_ledger%ROWTYPE;
BEGIN
  IF p_ref IS NULL OR p_actual IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('settle:' || p_ref)::bigint);
  IF EXISTS (SELECT 1 FROM public.usage_ledger WHERE ref = p_ref AND kind = 'settle') THEN RETURN; END IF;
  SELECT * INTO v_row FROM public.usage_ledger
   WHERE ref = p_ref AND kind = 'reserve' ORDER BY id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.usage_ledger (user_id, metric, amount, ref, period, kind)
  VALUES (v_row.user_id, v_row.metric, p_actual - v_row.amount, p_ref, p_period, 'settle')
  ON CONFLICT (ref) WHERE kind = 'settle' DO NOTHING;
END;
$$;

-- ④ 写型分享 RPC 对 anon 收回（函数内 auth.uid() 为 NULL 本就返回 NULL）
REVOKE EXECUTE ON FUNCTION public.upsert_public_category_share(text) FROM anon;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
