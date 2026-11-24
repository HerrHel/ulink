-- 注销不再物理删除订单：改为去标识化保留 3 年，期满由 maintenance 日跑删除（2026-11-24）
--
-- 背景：
--   purge_user_data（20261109000003）注销时连 orders 一并 DELETE。但《电子商务法》第三十一条、
--   《网络交易监督管理办法》要求交易记录自交易完成之日起保存不少于三年，物理删除既无法履行
--   留存义务，也无法应对注销后的退款/对账争议。个保法第四十七条第二款允许「法律、行政法规
--   规定的保存期限未届满」时停止除存储与必要安全保护之外的处理——即去标识化保留。
--
-- 做法：
--   ① purge_user_data：orders 不再 DELETE，改为
--        user_id      → 'deleted:' || sha256(uid)（不可逆；仅当争议方自证原 uid 时可比对）
--        pay_payload  → NULL（收银台二维码/跳转参数，对留存无用）
--      保留金额、套餐、渠道、渠道订单号、状态、支付/退款时间、回调原文（对账与争议凭证）。
--      其余表（usage_ledger / entitlements 等）照旧物理删除——它们不是交易记录。
--      'deleted:' 前缀不会与真实 uid 冲突，前端/云函数按 user_id 查不到这些行。
--   ② cleanup_expired_data：新增第 ⑤ 步，删除已去标识化且交易完成满 3 年的订单。
--      其余 ①-④ 步与 20261105000001 逐字一致。
--   ③ 历史全库备份 db_backup 里该用户的订单行仍由 purge_backup_rows_for_user 擦除（备份 30 天
--      滚动，线上表已保留去标识化副本，不需要备份里再有一份带 uid 的）。
--
-- 幂等：全部为 CREATE OR REPLACE；重复执行结果不变。

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_user_data(p_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  v_ledger integer := 0; v_orders integer := 0; v_bm integer := 0;
  v_grp integer := 0; v_cat integer := 0; v_attr integer := 0;
  v_sec integer := 0; v_logs integer := 0; v_check integer := 0;
  v_share integer := 0; v_extra integer := 0;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  DELETE FROM public.usage_ledger WHERE user_id = p_uid; GET DIAGNOSTICS v_ledger = ROW_COUNT;
  -- 交易记录法定留存：去标识化而非删除（见文件头）
  UPDATE public.orders
     SET user_id = 'deleted:' || encode(sha256(convert_to(p_uid, 'UTF8')), 'hex'),
         pay_payload = NULL
   WHERE user_id = p_uid;
  GET DIAGNOSTICS v_orders = ROW_COUNT;
  DELETE FROM public.entitlements WHERE user_id = p_uid;
  DELETE FROM public.link_check_history WHERE user_id = p_uid; GET DIAGNOSTICS v_check = ROW_COUNT;
  DELETE FROM public.error_logs WHERE user_id = p_uid; GET DIAGNOSTICS v_logs = ROW_COUNT;
  DELETE FROM public.public_category_shares WHERE user_id = p_uid; GET DIAGNOSTICS v_share = ROW_COUNT;
  DELETE FROM public.custom_attributes WHERE user_id = p_uid; GET DIAGNOSTICS v_attr = ROW_COUNT;
  DELETE FROM public.user_security WHERE user_id = p_uid; GET DIAGNOSTICS v_sec = ROW_COUNT;
  DELETE FROM public.bookmarks WHERE user_id = p_uid; GET DIAGNOSTICS v_bm = ROW_COUNT;
  DELETE FROM public.sibling_groups WHERE user_id = p_uid; GET DIAGNOSTICS v_grp = ROW_COUNT;
  DELETE FROM public.categories WHERE user_id = p_uid; GET DIAGNOSTICS v_cat = ROW_COUNT;

  DELETE FROM public.data_history WHERE user_id = p_uid;
  DELETE FROM public.deleted_item_graveyard WHERE user_id = p_uid;
  DELETE FROM public.audit_log WHERE uid = p_uid;
  DELETE FROM public.legacy_identity_map WHERE cb_sub = p_uid OR legacy_uuid = p_uid;
  DELETE FROM private.deep_quota_refunds WHERE uid = p_uid;
  DELETE FROM private.rate_limit_counters WHERE key LIKE '%' || p_uid || '%';
  GET DIAGNOSTICS v_extra = ROW_COUNT;
  PERFORM private.purge_backup_rows_for_user(p_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'usage_ledger', v_ledger, 'bookmarks', v_bm,
      'sibling_groups', v_grp, 'categories', v_cat, 'custom_attributes', v_attr,
      'user_security', v_sec, 'error_logs', v_logs, 'link_check_history', v_check,
      'public_category_shares', v_share, 'rate_limit_counters', v_extra,
      'db_backup_rows_purged', true
    ),
    'anonymized', jsonb_build_object('orders', v_orders),
    'at', now()
  );
END;
$$;

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
  v_anon    integer := 0;
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

  -- ⑤ 已注销用户的去标识化订单：交易完成（有退款按退款时间）满 3 年后删除
  DELETE FROM public.orders
   WHERE user_id LIKE 'deleted:%'
     AND GREATEST(created_at, coalesce(paid_at, created_at), coalesce(refunded_at, created_at))
         < now() - interval '3 years';
  GET DIAGNOSTICS v_anon = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'error_logs_deleted', v_logs,
    'trash_deleted', v_trash,
    'trash_enabled', (p_trash_days > 0),
    'history_deleted', v_hist,
    'expired_orders_failed', v_expired,
    'anonymized_orders_deleted', v_anon,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_data(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_data(integer, integer) TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_data(integer, integer) IS
  '清理过期错误日志（默认 365 天）、可选回收站软删除数据（默认关闭）、按 plan history.days 清理历史版本、标记过期未支付订单为 failed、删除已去标识化且满 3 年的订单。由 maintenance 定时云函数调用。';

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
