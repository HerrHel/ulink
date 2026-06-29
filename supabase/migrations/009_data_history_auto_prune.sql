-- data_history 服务端自动清理
-- INSERT 后保留最近 10 条，自动删除更旧的版本

CREATE OR REPLACE FUNCTION prune_data_history()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM data_history
  WHERE id IN (
    SELECT id FROM data_history
    WHERE user_id = NEW.user_id AND item_id = NEW.item_id
    ORDER BY created_at DESC OFFSET 10
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prune_data_history ON data_history;
CREATE TRIGGER trg_prune_data_history
  AFTER INSERT ON data_history FOR EACH ROW
  EXECUTE FUNCTION prune_data_history();

SELECT pg_notify('pgrst', 'reload schema');
