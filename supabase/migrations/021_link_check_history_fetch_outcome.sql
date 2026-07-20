-- 021_link_check_history_fetch_outcome.sql
-- 死链检测 evidence API：check-link Edge 不再回产品 verdict（dead/blocked），
-- 改回 fetch_outcome（5 值）+ http_status。HTTP 分类（classifyHttpStatus）的
-- 结果仍写入 status 列作历史归档，但客户端从此只读 fetch_outcome。
--
-- status 列与既有 CHECK 约束 ('alive','dead','blocked','unknown') 保留不动：
--   - 旧行 fetch_outcome 为 NULL（无消费方，无需回填）
--   - Edge 写新行时同时填 status（归档）与 fetch_outcome（决策依据）
-- 后续若要彻底统一语义，可再单独迁移废弃 status 列；本轮仅加列以最小侵入。

ALTER TABLE link_check_history
  ADD COLUMN IF NOT EXISTS fetch_outcome TEXT;

ALTER TABLE link_check_history
  DROP CONSTRAINT IF EXISTS link_check_history_fetch_outcome_check;

ALTER TABLE link_check_history
  ADD CONSTRAINT link_check_history_fetch_outcome_check
  CHECK (fetch_outcome IS NULL
         OR fetch_outcome IN ('ok', 'timeout', 'connect_error', 'ssrf_reject', 'redirect_denied'));
