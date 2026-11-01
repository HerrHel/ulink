-- 用户上传媒体 bucket（deep-media）
--
-- 用途：网页端「上传媒体解析」把用户主动选择的视频/音频/图片传到 CloudBase 存储，
-- 再由 extract-video 的 deep_upload 通道交给 worker 做 ASR/OCR；处理完由前端删除对象。
--
-- 设计：
-- - public bucket：worker 通过公开 URL 拉取（对象路径含随机串，且处理完立即删除）；
-- - 路径约定 {userId}/deep/{timestamp}-{random}-{filename}，RLS 只允许本人写入/删除自己目录；
-- - 限制 200MB，只允许音频/视频/图片 MIME，拒绝可执行/文档类型。
--
-- 注意：tcb db execute 只接受单语句，应用时逐条执行（见 scripts/apply-cloudbase-migration.mjs）。

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deep-media',
  'deep-media',
  true,
  209715200,
  ARRAY['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/ogg',
        'video/mp4','video/quicktime','video/webm','image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY deep_media_upload_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deep-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY deep_media_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deep-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
