-- 深度解析失败退额度：按 job_id 幂等退回一次（跨实例安全）
--
-- 背景：extract-video 在提交时就用 consume_rate_limit 扣减 video.deep.daily，
-- 但 worker 异步任务可能失败（平台风控/下载失败/无音频等）。失败任务应在用户轮询到
-- status=failed 时退回额度，避免「先扣后抓」白扣。
--
-- 设计：
-- - private.deep_quota_refunds 以 job_id 为主键，天然幂等（多实例/重复轮询只退一次）；
-- - refund_deep_quota 用单条 SQL（无分号）实现，兼容 `tcb db execute --sql` 的单语句执行；
-- - 只对 service_role 开放（云函数服务端调用），不暴露给前端；
-- - 退回时只减计数（GREATEST(count-1,0)），不重置窗口，避免被用来刷额度。

CREATE TABLE IF NOT EXISTS private.deep_quota_refunds (
  job_id TEXT PRIMARY KEY,
  uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON private.deep_quota_refunds FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refund_deep_quota(
  p_uid UUID,
  p_job_id TEXT,
  p_key TEXT,
  p_window_secs INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
AS $$
  WITH ins AS (
    INSERT INTO private.deep_quota_refunds (job_id, uid)
    VALUES (p_job_id, p_uid)
    ON CONFLICT (job_id) DO NOTHING
    RETURNING 1
  ), upd AS (
    UPDATE private.rate_limit_counters
       SET count = GREATEST(count - 1, 0)
     WHERE key = p_key
       AND EXISTS (SELECT 1 FROM ins)
     RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ins)
$$;

REVOKE ALL ON FUNCTION public.refund_deep_quota(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_deep_quota(UUID, TEXT, TEXT, INTEGER) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
