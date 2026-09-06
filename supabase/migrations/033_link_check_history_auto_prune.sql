-- 033: link_check_history 服务端自动剪枝
-- INSERT 后每 (user_id, bookmark_id) 只保留最近 5 条，与客户端 useDeadLinkChecker
-- 的 MAX_HIST=5 同一口径。此前该表只写不剪（007 的 cleanup_old_check_history 30 天
-- 函数从未被调度），单用户批量死链检测会把行数无限推高，是免费档 DB 触顶最快的表。
--
-- 与 009（data_history 剪枝）同模式：触发器以调用者身份执行，依赖表上既有的
-- DELETE 策略（007 "Users can delete own check history"），不引入 SECURITY DEFINER。
-- 存量超限行不在此回填清理（迁移上下文绕 FORCE RLS 不可靠）：该书签下次被检测时
-- 触发器即按新口径收敛，自愈而非一次性手术。

CREATE OR REPLACE FUNCTION prune_link_check_history()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM link_check_history
  WHERE id IN (
    SELECT id FROM link_check_history
    WHERE user_id = NEW.user_id AND bookmark_id = NEW.bookmark_id
    ORDER BY checked_at DESC OFFSET 5
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prune_link_check_history ON link_check_history;
CREATE TRIGGER trg_prune_link_check_history
  AFTER INSERT ON link_check_history FOR EACH ROW
  EXECUTE FUNCTION prune_link_check_history();

SELECT pg_notify('pgrst', 'reload schema');
