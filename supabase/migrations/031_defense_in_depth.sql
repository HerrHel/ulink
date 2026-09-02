-- 031_defense_in_depth.sql
-- 纵深防御加固（安全极限冲刺）：表/序列/函数权限最小化 + prune 性能门槛。
--
-- 时间：2026-09-02（docs/BACKEND_AUDIT.md 9.5+ 冲刺）
-- 执行：supabase db push --linked
--
-- 背景（远程实测）：
--   - anon 对全部 10 张 public 表拥有 ALL（DELETE/INSERT/REFERENCES/SELECT/
--     TRIGGER/TRUNCATE/UPDATE）——RLS 是唯一防线。TRUNCATE/TRIGGER 绕过 RLS，
--     一旦未来某表漏开 RLS/策略写宽即全表沦陷。公开读已全走 SECURITY DEFINER
--     RPC（028/030 后零 anon 表策略），anon 不需要任何表 GRANT。
--   - authenticated 同样被默认 GRANT ALL——CRUD 由 RLS 精确控行，但
--     TRUNCATE/TRIGGER/REFERENCES 越权且无用。
--   - 3 个触发器函数（update_updated_at / prune_data_history / throttle_error_logs）
--     proacl = PUBLIC EXECUTE（`=X/postgres`）→ 匿名可尝试直接调用。
--   - 2 个序列（data_history_id_seq / error_logs_id_seq）anon 均有 rwU；
--     error_logs_id_seq 自 030 后 authenticated 也无 INSERT 路径。
--
-- 本迁移原则：GRANT 最小化 + RLS 控行 + SECURITY DEFINER 控列，三层纵深。
-- 回滚：逐个 REVOKE 反转为 GRANT（注释给出）或整体重建 schema。

-- ═══════════════════════════════════════════════════════════════════
-- 1. 表权限：anon 零表权限；authenticated 去 TRUNCATE/TRIGGER/REFERENCES
-- ═══════════════════════════════════════════════════════════════════

-- 1.1 anon：全部业务表 ALL 收回（公开读仅经 RPC，函数 EXECUTE 单独授权不受影响）
--     回滚：GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 1.2 authenticated：保留 CRUD（RLS 控行），收回 RLS 管不到的 TRUNCATE/TRIGGER/REFERENCES
--     回滚：GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 1.3 默认权限（防未来迁移建表后 anon 自动获得 ALL——Supabase 模板的 default
--     privileges 会授 anon/authenticated 全权限给新表）
--     回滚：ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- 1.4 同步收紧 pg_database_owner 的默认授权（Dashboard/SQL Editor 建表路径）
--     回滚：对应的 GRANT 语句
ALTER DEFAULT PRIVILEGES FOR ROLE pg_database_owner IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE pg_database_owner IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 2. 序列权限最小化
-- ═══════════════════════════════════════════════════════════════════
-- data_history_id_seq   ：authenticated 插入 data_history 需要（保留 usage）
-- error_logs_id_seq     ：030 后无任何 INSERT 路径 → 仅 postgres/service_role
-- 回滚：GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON SEQUENCE public.error_logs_id_seq FROM authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 3. 触发器函数 EXECUTE 收权（防匿名直接调用）
-- ═══════════════════════════════════════════════════════════════════
-- 三个函数由表上的触发器调用：
--   - update_updated_at        SECURITY INVOKER，挂在 5 张业务表 → authenticated 触发
--   - prune_data_history       SECURITY INVOKER，挂 data_history → authenticated 触发
--   - throttle_error_logs      SECURITY DEFINER，挂 error_logs → service_role 触发（030 后唯一写入者）
-- REVOKE PUBLIC EXECUTE 后按触发者补 GRANT；anon 全程无执行权。
-- 回滚：GRANT EXECUTE ON FUNCTION ... TO PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_data_history() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.throttle_error_logs() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_updated_at() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_data_history() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.throttle_error_logs() TO service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 4. prune_data_history 性能门槛（P1「唯一非线性劣化点」）
-- ═══════════════════════════════════════════════════════════════════
-- 009 原实现：每次 INSERT 都执行 DELETE ... OFFSET 10（组未超限时也全扫+零删除）。
-- 改造：先 count（命中 (user_id, item_id) 索引，组内通常 ≤11 行）预检，
--       仅超 10 条才 DELETE——正常路径从「每次全扫」降为「每次索引 count」。
-- ⚠️ CREATE OR REPLACE 会重置 proconfig：必须内联 SET search_path = public，
--    否则丢失 028 的 search_path 固定。
-- 回滚：恢复 009 原函数体（无 count 预检）。

CREATE OR REPLACE FUNCTION public.prune_data_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt
  FROM data_history
  WHERE user_id = NEW.user_id AND item_id = NEW.item_id;

  IF v_cnt > 10 THEN
    DELETE FROM data_history
    WHERE id IN (
      SELECT id FROM data_history
      WHERE user_id = NEW.user_id AND item_id = NEW.item_id
      ORDER BY created_at DESC OFFSET 10
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prune_data_history() IS
  'data_history 历史版本裁剪（保留最近 10 条/组）。031 加 count 预检：'
  '组未超限时零 DELETE（009 原实现每次 INSERT 全扫组）。pg_cron 托管不可用，'
  '暂以「索引 count + 阈值触发」逼近 O(1) 常态路径。';


-- 通知 PostgREST 重载 schema
SELECT pg_notify('pgrst', 'reload schema');
