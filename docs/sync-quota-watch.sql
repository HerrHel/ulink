-- sync-quota-watch — Supabase 配额监控周报（触顶防护）
--
-- 用途：在 Supabase SQL Editor 手动执行，或挂 GitHub Action cron（service_role key）
-- 每周跑一次，提前发现「哪张表在把免费档 500MB 吃掉」。当前增长最快的是
-- data_history（每项 10 条 JSONB 快照，notes 大时单项可累计数百 KB）与
-- link_check_history（尚无自动剪枝触发器）。
--
-- 阈值参考（免费档）：任一表 total_size > 100MB 即应处理（剪枝/迁移/升级）；
-- sum(total_size) > 400MB（80%）为升级 Supabase Pro 的触发线。

-- ① 按表体积排名（含索引与 TOAST，即磁盘真实占用）
SELECT
  relname                                   AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid))  AS total_size,
  pg_total_relation_size(c.oid) / 1024 / 1024    AS total_mb,
  (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;

-- ② 增长热点抽样：两张高频增长表近 30 天的行数
SELECT
  'data_history' AS tbl, count(*) AS rows
FROM data_history
WHERE created_at > now() - interval '30 days'
UNION ALL
SELECT
  'link_check_history', count(*)
FROM link_check_history
WHERE checked_at > now() - interval '30 days';

-- ③ 云同步用户规模（判断离 auth MAU / DB 配额还有多远）
SELECT
  (SELECT count(DISTINCT user_id) FROM bookmarks)                    AS sync_users_bookmarks,
  (SELECT count(*) FROM bookmarks WHERE deleted_at IS NULL)          AS alive_bookmarks,
  (SELECT count(*) FROM sibling_groups WHERE deleted_at IS NULL)     AS alive_groups;
