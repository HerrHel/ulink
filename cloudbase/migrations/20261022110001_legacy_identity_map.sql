-- 老用户身份映射：Supabase uuid → CloudBase sub
--
-- 背景：老库里 user_id 存的是 Supabase 的 uuid；用户迁到 CloudBase 重新登录后，
-- auth.uid() 给的是 CloudBase 新生成的 sub 字符串，两者对不上。不做映射，
-- 用户登录后看到的是空书架。
--
-- 设计：
--   * 邮箱是唯一稳定的跨平台锚点 → 映射表以邮箱为键，用户**首次登录时认领**
--   * 认领不信任客户端入参：uid 取 auth.uid()，邮箱取 JWT 的 email claim（auth.email()）
--   * 认领动作 = 把各表 user_id 从旧 uuid 改写成新 sub，然后落 claimed_at 防重复
--   * 映射表本身不开任何直接读写，只有 SECURITY DEFINER 函数能碰

create table if not exists public.legacy_identity_map (
  legacy_uuid text primary key,
  email       text not null,
  cb_sub      text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_legacy_identity_cb_sub
  on public.legacy_identity_map (cb_sub) where cb_sub is not null;

create index if not exists idx_legacy_identity_email
  on public.legacy_identity_map (lower(email));

alter table public.legacy_identity_map enable row level security;
alter table public.legacy_identity_map force row level security;

-- 不给 anon / authenticated 任何直接权限：读也不行，避免邮箱-uid 关联被枚举
revoke all on public.legacy_identity_map from anon, authenticated;

-- 认领：无参，身份完全来自 JWT
create or replace function public.claim_legacy_identity()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid   text := auth.uid();
  v_email text := auth.email();
  v_legacy text;
  v_moved  jsonb := '{}'::jsonb;
  v_n      int;
begin
  if v_uid is null or v_uid = '' then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'email claim missing' using errcode = '28000';
  end if;

  -- 已经是认领过的账号直接短路
  if exists (select 1 from public.legacy_identity_map where cb_sub = v_uid) then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  end if;

  select legacy_uuid into v_legacy
  from public.legacy_identity_map
  where lower(email) = lower(v_email)
    and cb_sub is null
  limit 1;

  if v_legacy is null then
    return jsonb_build_object('claimed', false, 'reason', 'no_pending_mapping');
  end if;

  update public.bookmarks set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('bookmarks', v_n);

  update public.sibling_groups set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('sibling_groups', v_n);

  update public.categories set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('categories', v_n);

  update public.custom_attributes set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('custom_attributes', v_n);

  update public.data_history set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('data_history', v_n);

  update public.deleted_item_graveyard set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('deleted_item_graveyard', v_n);

  update public.public_category_shares set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('public_category_shares', v_n);

  update public.link_check_history set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('link_check_history', v_n);

  -- user_security 的 PK 就是 user_id：若新 sub 已有行，先删旧行避免主键冲突
  delete from public.user_security
   where user_id = v_legacy
     and exists (select 1 from public.user_security s2 where s2.user_id = v_uid);
  update public.user_security set user_id = v_uid where user_id = v_legacy;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('user_security', v_n);

  update public.legacy_identity_map
     set cb_sub = v_uid, claimed_at = now()
   where legacy_uuid = v_legacy;

  return jsonb_build_object('claimed', true, 'legacy_uuid', v_legacy, 'moved', v_moved);
end;
$$;

revoke all on function public.claim_legacy_identity() from public, anon;
grant execute on function public.claim_legacy_identity() to authenticated;

-- 认领进度查询：只回一条聚合数，不暴露别人的邮箱或 uuid
create or replace function public.legacy_identity_status()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'total', count(*),
    'claimed', count(*) filter (where cb_sub is not null),
    'pending', count(*) filter (where cb_sub is null)
  )
  from public.legacy_identity_map;
$$;

revoke all on function public.legacy_identity_status() from public, anon;
grant execute on function public.legacy_identity_status() to authenticated;
