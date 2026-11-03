-- ⚠️ 本文件对应的方案已废弃，保留仅为对齐线上执行记录。
-- 原因：CloudBase 的 PG 环境中 node-sdk 不支持 uploadFile（STORAGE_NOT_SUPPORTED），
-- 备份无法写云存储，改为落库方案（见 20261103000005_db_backup_table.sql）。
-- 该函数暂无调用方，可安全忽略或后续清理。

-- 备份文件轮转：列出超过保留期的数据库备份对象路径
--
-- 与 list_expired_deep_media 同款做法（查 storage.objects），
-- 由 maintenance 每日调用后经 node-sdk deleteFile 删除。
-- 备份对象统一放在 deep-media 桶的 db-backup/ 前缀下。

CREATE OR REPLACE FUNCTION public.list_expired_db_backup_paths(p_keep_days INTEGER DEFAULT 30)
RETURNS TEXT[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = storage, public
AS $$
  SELECT COALESCE(array_agg(name), ARRAY[]::text[])
  FROM (
    SELECT name
    FROM storage.objects
    WHERE bucket_id = 'deep-media'
      AND name LIKE 'db-backup/%'
      AND created_at < now() - make_interval(days => GREATEST(COALESCE(p_keep_days, 30), 1))
    ORDER BY created_at ASC
    LIMIT 200
  ) AS expired
$$;

REVOKE ALL ON FUNCTION public.list_expired_db_backup_paths(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_db_backup_paths(INTEGER) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
