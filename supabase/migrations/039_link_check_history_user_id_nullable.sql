-- 039: link_check_history.user_id 允许 NULL（匿名检测归档）
--
-- 背景：check-link 的 CloudBase HTTP 云函数 v1 **不验签**（「不验签就采信」比不填更糟，
-- 与 report-error 同口径），匿名探测记录 user_id 落 NULL。而 007 建表时
-- `user_id UUID NOT NULL` 使该路径直接 DATABASE_23502（约束先于 RLS 触发），
-- 表现为接口 200 但 history 一行不落。
-- 客户端对 link_check_history 只写不读（无产品功能依赖归属），NULL 归属语义正确：
-- 匿名行也不匹配 "Users can view own check history"（auth.uid() = user_id），不会
-- 混进任何用户的历史视图。后续接入 token 验签后再把 user_id 归位到真实用户。
--
-- 同步：033 的剪枝触发器按 `user_id = NEW.user_id` 分组——NULL 时永假，
-- 匿名行将永不剪枝、无限积累（该表是免费档 DB 触顶最快的表，见 033 注释）。
-- 改用 IS NOT DISTINCT FROM 使 NULL 分组正常剪枝；顺带给函数加
-- SET search_path 加固（033 原版漏了）。

ALTER TABLE link_check_history ALTER COLUMN user_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION prune_link_check_history()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM link_check_history
  WHERE id IN (
    SELECT id FROM link_check_history
    WHERE user_id IS NOT DISTINCT FROM NEW.user_id
      AND bookmark_id IS NOT DISTINCT FROM NEW.bookmark_id
    ORDER BY checked_at DESC OFFSET 5
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prune_link_check_history ON link_check_history;
CREATE TRIGGER trg_prune_link_check_history
  AFTER INSERT ON link_check_history FOR EACH ROW
  EXECUTE FUNCTION prune_link_check_history();

SELECT pg_notify('pgrst', 'reload schema');
