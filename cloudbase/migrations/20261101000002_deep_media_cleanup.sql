-- 用户上传媒体临时对象清理：列出 deep-media 中超过保留期的对象路径
--
-- 背景：网页端上传后处理完会主动删除；但用户中途关闭页面/网络失败时对象可能残留。
-- maintenance 定时函数会调用本 RPC 列出过期对象，再通过 node-sdk deleteFile 删除。
--
-- 只返回路径（不返回 URL），限制 200 条/次，避免单次维护任务过大。

CREATE OR REPLACE FUNCTION public.list_expired_deep_media(p_keep_hours INTEGER)
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
      AND created_at < now() - make_interval(hours => GREATEST(COALESCE(p_keep_hours, 24), 1))
    ORDER BY created_at ASC
    LIMIT 200
  ) AS expired
$$;

REVOKE ALL ON FUNCTION public.list_expired_deep_media(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_deep_media(INTEGER) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
