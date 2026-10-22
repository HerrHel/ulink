-- 修复 record_permanent_delete：把守卫条件从 auth.users.id 改为 auth.users.sub
--
-- 问题（2026-10-22 实测发现）：
--   032 迁移里的守卫写成 `SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id`。
--   Supabase 的 auth.users.id 是 uuid，与本项目 user_id(uuid) 同型，可以编译；
--   但 CloudBase 的 auth.users.id 是 **bigint**、而 user_id 是 **text**，
--   于是 PostgreSQL 直接报 `operator does not exist: bigint = text (SQLSTATE 42883)`。
--
--   更糟的是这个错误发生在**语句规划阶段**：只要对 bookmarks / sibling_groups 等表
--   执行 DELETE，即使守卫那一行逻辑上永远不会进入分支，也会整体失败。
--   后果是「彻底删除」在 CloudBase 上完全不可用，同步的物理删除也会挂。
--
-- 语义修正：CloudBase 里用户标识是 JWT 的 sub（text），所以应比对 auth.users.sub。
--   - 认领后的用户：user_id == sub → 命中，正常写入墓园
--   - 尚未认领的老数据（user_id 还是 Supabase uuid）：查不到 → 早退，不写墓园（与原意一致）

create or replace function public.record_permanent_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from auth.users u where u.sub = old.user_id) then
    return old;
  end if;
  insert into public.deleted_item_graveyard (user_id, table_name, item_id)
  values (old.user_id, tg_table_name, old.id)
  on conflict (user_id, table_name, item_id) do nothing;
  return old;
end;
$$;
