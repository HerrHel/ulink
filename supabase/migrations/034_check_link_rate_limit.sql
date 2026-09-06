-- 034: check-link 每用户限流计数器
--
-- 为什么不用 link_check_history 计数：033 剪枝把每书签只留 5 条，同一 bookmark
-- 高频重查时窗口内计数恒 ≤5，限流可被单点轰炸绕过。需要独立于业务表的计数状态。
--
-- 为什么放 private schema：计数器是纯内部状态（无行级安全语义），放 public 会
-- 拖进「public 全表 FORCE RLS / anon 零 GRANT」两条 pgTAP 全局不变量的合规面；
-- private schema 对 anon/authenticated 无 USAGE，物理隔离，只能经 SECURITY
-- DEFINER 函数访问。

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.rate_limit_counters (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 0
);
REVOKE ALL ON private.rate_limit_counters FROM PUBLIC, anon, authenticated;

-- 原子「消费一次配额」：返回 true=放行 / false=超额。
-- 滑动窗口简化为定长窗口（window_start 过期即重置），对限流语义足够且免锁。
CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_limit INTEGER, p_window_secs INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 1; END IF;
  IF p_window_secs IS NULL OR p_window_secs < 1 THEN p_window_secs := 60; END IF;

  INSERT INTO private.rate_limit_counters AS r (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_secs) THEN now()
      ELSE r.window_start END,
    count = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_secs) THEN 1
      ELSE r.count + 1 END
  RETURNING count INTO v_count;

  -- 顺手清掉早已过期的其它窗口行：每用户一行、行极小，清扫防久积
  DELETE FROM private.rate_limit_counters
   WHERE window_start < now() - make_interval(secs => p_window_secs * 10);

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
