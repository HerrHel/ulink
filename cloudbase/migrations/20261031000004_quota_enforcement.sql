-- 额度强制执行（2026-10-31）
--
-- 目标：让「对外展示的额度」与「服务端可拒绝的执行点」一致。
-- 1) free 档补齐 ai.requests.daily = 20（此前只有 PRO 有 100，免费档无键 →
--    mimo-chat 无法判断，等于免费用户无每日请求上限；token 总量仍在拦）。
-- 2) 移除 sync.devices：同步没有设备体系，无法执行，按 docs/QUOTA_ENFORCEMENT.md
--    建议撤下承诺（不再出现在购买页/plans.features）。
-- 3) history.days 落地为「历史版本保留期」：cleanup_expired_data 按每个用户的
--    plan 的 history.days 清理 data_history（无权益用户按 90 天）。
--    该函数已由 maintenance 定时任务调用，无需改云函数代码。
--
-- 幂等：CREATE OR REPLACE / jsonb_set / - 操作均可重复执行。

BEGIN;

-- ── 1) free 档每日 AI 请求上限 ─────────────────────────────────────
UPDATE public.plans
   SET features = jsonb_set(features, '{ai.requests.daily}', '20'::jsonb, true)
 WHERE id = 'free'
   AND NOT (features ? 'ai.requests.daily');

-- ── 2) 撤下无法执行的 sync.devices ─────────────────────────────────
UPDATE public.plans
   SET features = features - 'sync.devices'
 WHERE features ? 'sync.devices';

-- ── 3) 历史版本按 plan 保留期清理 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_data(
  p_error_log_days integer DEFAULT 365,
  p_trash_days     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs  integer := 0;
  v_trash integer := 0;
  v_bm    integer := 0;
  v_grp   integer := 0;
  v_hist  integer := 0;
BEGIN
  IF p_error_log_days IS NULL OR p_error_log_days < 1 THEN
    p_error_log_days := 365;
  END IF;

  -- ① 错误日志：超过保留期即删除
  DELETE FROM public.error_logs
   WHERE created_at < now() - make_interval(days => p_error_log_days);
  GET DIAGNOSTICS v_logs = ROW_COUNT;

  -- ② 回收站软删除数据：默认不清理（p_trash_days=0 表示关闭）
  IF p_trash_days > 0 THEN
    DELETE FROM public.bookmarks
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => p_trash_days);
    GET DIAGNOSTICS v_bm = ROW_COUNT;

    DELETE FROM public.sibling_groups
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => p_trash_days);
    GET DIAGNOSTICS v_grp = ROW_COUNT;

    v_trash := v_bm + v_grp;
  END IF;

  -- ③ 历史版本：按用户 plan 的 history.days 保留（无权益/未配置按 90 天）
  DELETE FROM public.data_history dh
   USING (
     SELECT DISTINCT h.user_id,
            coalesce(
              (public.resolve_entitlement(h.user_id) -> 'features' ->> 'history.days')::int,
              90
            ) AS keep_days
       FROM public.data_history h
   ) u
   WHERE dh.user_id = u.user_id
     AND dh.created_at < now() - make_interval(days => GREATEST(u.keep_days, 1));
  GET DIAGNOSTICS v_hist = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'error_logs_deleted', v_logs,
    'trash_deleted', v_trash,
    'trash_enabled', (p_trash_days > 0),
    'history_deleted', v_hist,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_data(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_data(integer, integer) TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_data(integer, integer) IS
  '清理过期错误日志（默认 365 天）、可选回收站软删除数据（默认关闭）、按 plan history.days 清理历史版本。由 maintenance 定时云函数调用。';

COMMIT;
