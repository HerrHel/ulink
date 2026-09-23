-- 035_sync_graveyard_block_soft_delete_insert.sql
-- 墓园防线增强：禁止任何端将已物理删除（进入墓园）的条目以软删除快照重新 INSERT 云端。
--
-- 背景：
--   032 迁移中 sync_delete_guard 对 INSERT 守卫加了 `NEW.deleted_at IS NULL AND` 前置条件，
--   原意是放行常规软删墓碑。但在多设备场景下：设备 A 清空回收站（条目被物理 DELETE 进入墓园）后，
--   设备 B 登录时若本地留存该条目的软删快照，会以 upsert 重新将带 deleted_at 的记录推上云；
--   原 032 守卫误将软删快照放行，导致该条目在云端重新插入复活，并在设备 A 下次同步时重新污染回收站。
--
-- 修复：
--   只要条目存在于 deleted_item_graveyard 墓园中，任何 INSERT（不论 deleted_at 是否为空）一律拦截（RETURN NULL）。

CREATE OR REPLACE FUNCTION public.sync_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public.deleted_item_graveyard g
      WHERE g.user_id = NEW.user_id
        AND g.table_name = TG_TABLE_NAME
        AND g.item_id = NEW.id
    ) THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL
     AND COALESCE(NEW.updated_at_num, 0) <= COALESCE(OLD.updated_at_num, 0) THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_delete_guard() FROM PUBLIC;
