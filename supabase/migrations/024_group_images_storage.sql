-- Migration 024: group-images Storage bucket（组笔记图片上传）
-- 需求：组笔记支持上传图片，免费计划容量有限，前端压缩后存这里。
-- 设计：public bucket（公开分享页匿名可读），对象路径 {userId}/{groupId}/{filename}，
--       登录用户只能上传/删除自己 userId 目录下的对象；读对所有人公开。
--
-- 执行：Supabase Dashboard → SQL Editor → 粘贴本文件 → Run（Storage RLS 随 schema 生效）。

-- ── 1. 创建 public bucket（若已存在跳过）──
-- file_size_limit：5MB（前端已压缩，单张约 100~300KB，5MB 足够）
-- allowed_mime_types：白名单，拒绝非图片类型
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'group-images',
  'group-images',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. RLS：登录用户仅能写入/删除自己 userId 目录下的对象 ──
-- storage.foldername(name)[1] 取路径第一段（即 userId），与 auth.uid() 对齐，
-- 阻断越权读写他人目录。public bucket 的读对所有角色公开，无需额外 SELECT 策略。

DROP POLICY IF EXISTS "group-images upload own" ON storage.objects;
CREATE POLICY "group-images upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'group-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "group-images update own" ON storage.objects;
CREATE POLICY "group-images update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'group-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "group-images delete own" ON storage.objects;
CREATE POLICY "group-images delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'group-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
