-- 032_sync_delete_guard.sql
-- 同步删除防线：禁止旧存活快照复活软删墓碑 + 物理删除 graveyard。
--
-- 时间：2026-09-05（多设备「删除被复活」事故修复）
-- 执行：supabase db push --linked
--
-- 事故链路（用户实测）：
--   设备 A 与 B 内容一致。A 删除条目 X（软删 upsert：deleted_at=T1）并上云；
--   B 上线时把本地仍存活的旧快照（updated_at_num=T0 < T1）upsert 上云——
--   upsert 是 ON CONFLICT DO UPDATE 无条件覆盖，云端墓碑被盖成存活。
--   更糟的是复活行携带旧 updated_at_num=T0：A 端增量 pull 走
--   `gt updated_at_num > lastSyncAt` 永远拉不到它，即使 fullSync 的
--   remoteNewer 判定也是 skip——A 的墓碑与云端的存活从此永久分叉，
--   用户只能人工再删一遍。
--
-- 本迁移在服务端堵死两条复活路径（客户端编排修复见 syncPull/useCloudSync）：
--   1. UPDATE 复活：存活快照（deleted_at 置空）覆盖更新的软删墓碑 → 拒绝。
--   2. INSERT 复活：条目已被彻底删除（回收站清空 → 物理 DELETE）后，他端
--      残留的存活快照按「云端缺失」补推（_enqueueMissingToCloud 的
--      !remoteIds.has 分支）重新 INSERT → 拒绝。物理 DELETE 由 AFTER DELETE
--      触发器记入 deleted_item_graveyard（墓园），INSERT 守卫查墓园拦截面。
--
-- 语义边界（与客户端 LWW 一致）：
--   - 正规「从回收站恢复」走 restoreItem：updatedAt=Date.now() 必然晚于墓碑
--     时间戳 → NEW.updated_at_num > OLD → 放行，不受影响。
--   - 真正更晚的本地编辑（B 在 A 删除之后编辑过 X 且时钟无偏）按 LWW 放行
--     复活——这是编辑与删除并发的既有语义，本迁移只拦截「旧快照盖新墓碑」。
--   - 设备间时钟倒挂（B 时钟慢于 A）时，B 的正规恢复可能被误拦：客户端时间戳
--     LWW 的固有限制，现状 pull 游标同样受时钟偏差影响（客户端已加安全余量）。
--
-- 回滚：DROP TRIGGER 8 个 + DROP TABLE deleted_item_graveyard +
--       DROP FUNCTION sync_delete_guard / record_permanent_delete（注释见节尾）。

-- ═══════════════════════════════════════════════════════════════════
-- 1. deleted_item_graveyard：物理删除条目的墓园（仅 id 级记录，无内容列）
-- ═══════════════════════════════════════════════════════════════════
-- user_id 不设 FK 到 auth.users 会留下孤儿行，设 FK ON DELETE CASCADE 则在
-- 账户级联删除时存在「父行已删 → AFTER DELETE 触发器 INSERT 撞 FK」的时序
-- 风险——record_permanent_delete 内部先 EXISTS 探测 auth.users（SECURITY
-- DEFINER），账户删除进行中跳过记录，两条路径均不产生孤儿/违例。
CREATE TABLE IF NOT EXISTS public.deleted_item_graveyard (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  item_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, table_name, item_id)
);

ALTER TABLE public.deleted_item_graveyard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_item_graveyard FORCE ROW LEVEL SECURITY;

-- owner 只读（客户端 initialSync/resync 补推前排除墓园 id）；写入仅经触发器
-- （definer 路径）与 owner INSERT 策略兜底。无 UPDATE/DELETE 策略 = 墓园不可变。
CREATE POLICY "Users can view own graveyard" ON public.deleted_item_graveyard
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own graveyard" ON public.deleted_item_graveyard
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 031 默认权限已对新建表撤 anon；此处显式再撤一次，不依赖默认权限时序。
REVOKE ALL ON public.deleted_item_graveyard FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.deleted_item_graveyard FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 2. 守卫函数
-- ═══════════════════════════════════════════════════════════════════

-- 2.1 INSERT/UPDATE 复活守卫（BEFORE，挂在 4 张同步表上）
--   UPDATE：NEW 存活 + OLD 是墓碑 + NEW.updated_at_num <= OLD → RETURN OLD
--           （写回旧行 = 无变化成功，客户端 count=1 不进重试循环，op 正常出队）
--   INSERT：NEW 存活 + 墓园有记录 → RETURN NULL（静默跳过，PostgREST 不报错）
--   软删态写入（deleted_at 非空）一律放行：墓碑 upsert / 墓碑重建均属删除传播。
CREATE OR REPLACE FUNCTION public.sync_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL AND EXISTS (
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

-- 2.2 物理删除记录器（AFTER DELETE，挂在 4 张同步表上）
--   SECURITY DEFINER：需读 auth.users 探测账户是否正处于级联删除
--   （authenticated 无 auth.users SELECT 权限）。账户删除进行中跳过记录，
--   避免「级联删子行 → 触发器 INSERT 引用已删父行」的 FK 时序违例/孤儿行。
CREATE OR REPLACE FUNCTION public.record_permanent_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.deleted_item_graveyard (user_id, table_name, item_id)
  VALUES (OLD.user_id, TG_TABLE_NAME, OLD.id)
  ON CONFLICT (user_id, table_name, item_id) DO NOTHING;
  RETURN OLD;
END;
$$;

-- 031 护栏：触发器函数无 PUBLIC EXECUTE（触发器触发不需要 EXECUTE 权限）
REVOKE ALL ON FUNCTION public.sync_delete_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_permanent_delete() FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════
-- 3. 挂触发器（幂等：先 DROP 再 CREATE，迁移可重放）
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_bookmarks_resurrect_guard ON public.bookmarks;
CREATE TRIGGER trg_bookmarks_resurrect_guard
  BEFORE INSERT OR UPDATE ON public.bookmarks
  FOR EACH ROW EXECUTE FUNCTION public.sync_delete_guard();
DROP TRIGGER IF EXISTS trg_bookmarks_graveyard ON public.bookmarks;
CREATE TRIGGER trg_bookmarks_graveyard
  AFTER DELETE ON public.bookmarks
  FOR EACH ROW EXECUTE FUNCTION public.record_permanent_delete();

DROP TRIGGER IF EXISTS trg_sibling_groups_resurrect_guard ON public.sibling_groups;
CREATE TRIGGER trg_sibling_groups_resurrect_guard
  BEFORE INSERT OR UPDATE ON public.sibling_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_delete_guard();
DROP TRIGGER IF EXISTS trg_sibling_groups_graveyard ON public.sibling_groups;
CREATE TRIGGER trg_sibling_groups_graveyard
  AFTER DELETE ON public.sibling_groups
  FOR EACH ROW EXECUTE FUNCTION public.record_permanent_delete();

DROP TRIGGER IF EXISTS trg_categories_resurrect_guard ON public.categories;
CREATE TRIGGER trg_categories_resurrect_guard
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.sync_delete_guard();
DROP TRIGGER IF EXISTS trg_categories_graveyard ON public.categories;
CREATE TRIGGER trg_categories_graveyard
  AFTER DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.record_permanent_delete();

DROP TRIGGER IF EXISTS trg_custom_attributes_resurrect_guard ON public.custom_attributes;
CREATE TRIGGER trg_custom_attributes_resurrect_guard
  BEFORE INSERT OR UPDATE ON public.custom_attributes
  FOR EACH ROW EXECUTE FUNCTION public.sync_delete_guard();
DROP TRIGGER IF EXISTS trg_custom_attributes_graveyard ON public.custom_attributes;
CREATE TRIGGER trg_custom_attributes_graveyard
  AFTER DELETE ON public.custom_attributes
  FOR EACH ROW EXECUTE FUNCTION public.record_permanent_delete();

-- 客户端将直查墓园表（补推排除），通知 PostgREST 刷新 schema 缓存
SELECT pg_notify('pgrst', 'reload schema');
