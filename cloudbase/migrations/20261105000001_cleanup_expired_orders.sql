-- ─────────────────────────────────────────────────────────────────────
-- 20261105000001_cleanup_expired_orders.sql
--
-- 清理过期待支付订单：
-- 1. 立即将历史积压的所有已超过 expires_at 的 pending 订单标记为 failed；
-- 2. 在 cleanup_expired_data 维护函数中集成此逻辑，每日自动清理超期未付款单。
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. 立即批量更新已过期的历史待支付订单 ──────────────────────────────
UPDATE public.orders
   SET status = 'failed'
 WHERE status = 'pending'
   AND expires_at IS NOT NULL
   AND expires_at < now();

-- ── 2. 更新 cleanup_expired_data 维护函数 ───────────────────────────
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
  v_logs    integer := 0;
  v_trash   integer := 0;
  v_bm      integer := 0;
  v_grp     integer := 0;
  v_hist    integer := 0;
  v_expired integer := 0;
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

  -- ④ 自动将超过 expires_at 的待支付订单标记为 failed（超期未付款）
  UPDATE public.orders
     SET status = 'failed'
   WHERE status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'error_logs_deleted', v_logs,
    'trash_deleted', v_trash,
    'trash_enabled', (p_trash_days > 0),
    'history_deleted', v_hist,
    'expired_orders_failed', v_expired,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_data(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_data(integer, integer) TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_data(integer, integer) IS
  '清理过期错误日志（默认 365 天）、可选回收站软删除数据（默认关闭）、按 plan history.days 清理历史版本、标记过期未支付订单为 failed。由 maintenance 定时云函数调用。';

COMMIT;
