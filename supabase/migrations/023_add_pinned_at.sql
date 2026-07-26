-- Migration 023: Add pinned_at column to bookmarks and sibling_groups
-- AUDIT-R5：置顶态跨端同步。
-- Bookmark/SiblingGroup schema 已有 pinnedAt（ms 时间戳，可选），togglePin 写入并 _trackChange，
-- 但 useSyncMapping.toRemoteRow 的 bookmark/group 分支从不同步 pinned_at，RemoteRow 接口无该列，
-- partial sync 时静默跳过 → 置顶态跨设备丢失。本迁移补 DB 列，前端 toRemoteRow/fromRemote 补映射。
--
-- 列类型用 BIGINT（与 created_at_num/updated_at_num 同形，存 ms 时间戳），nullable
-- （未置顶 = NULL，置顶 = 置顶时刻 ms）。置顶是 owner 私有排序信息，公开分享不暴露
-- （get_public_group RPC 显式字段列表不含 pinned_at，符合 SEC-01 列隔离原则），
-- 故无需为 pinned_at 调整 RLS，随表默认 owner-only 策略自然保护。
--
-- 既有书签/组 default NULL（未置顶），无需 backfill。
--
-- 执行：Supabase Dashboard → SQL Editor → 粘贴本文件 → Run
--       然后部署前端 toRemoteRow/fromRemote 映射代码（已在本 commit 一并落地）。两端都到位后半同步才生效。

-- ── 1. bookmarks 表加 pinned_at ──
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS pinned_at BIGINT DEFAULT NULL;

-- ── 2. sibling_groups 表加 pinned_at ──
ALTER TABLE sibling_groups ADD COLUMN IF NOT EXISTS pinned_at BIGINT DEFAULT NULL;

-- ── 3. 置顶排序查询索引（按 user_id + 置顶时间倒序常用，与 008 sync indexes 风格一致） ──
CREATE INDEX IF NOT EXISTS idx_bookmarks_pinned_at ON bookmarks(user_id, pinned_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sibling_groups_pinned_at ON sibling_groups(user_id, pinned_at DESC NULLS LAST);

SELECT pg_notify('pgrst', 'reload schema');
