-- 分享页访问统计（2026-11-25）：分享页是主要引流入口，先把「谁看了、从哪来、有没有转化」量出来。
--
-- 设计：
--   ① 只存「按天聚合的计数」，不存逐条访问、不存 IP / UA / cookie —— 无个人信息，
--      不进 purge_user_data 的删除面（分享被删后行变孤儿，get_my_share_stats 按归属 join 自然不可见）。
--   ② 表放 private schema（同 rate_limit_counters）：不进「public 全表 FORCE RLS / anon 零 GRANT」
--      两条全局不变量的合规面，只能经 SECURITY DEFINER 函数访问。
--   ③ 事件口径（event）：
--        view    分享内容页成功渲染（GET，非爬虫）
--        gate    密码门被展示（GET，非爬虫）
--        preview 社交平台/IM 抓取链接预览（爬虫 UA）——说明链接被贴到了某处
--        cta     点了顶栏「保存这些链接」（经 /s/.../go 跳转计数）
--        start   点了文末「免费开始」（同上）
--        fork    在应用内真正完成保存（登录用户调 record_share_fork）
--      source：utm_source / from 参数 > 外站 Referer 主机名 > 'direct'；规范化为 [a-z0-9._-]{1,40}。
--   ④ 天按北京时间切分。
--
-- 幂等：CREATE IF NOT EXISTS / CREATE OR REPLACE；重复执行结果不变。

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.share_stats_daily (
  share_kind TEXT NOT NULL CHECK (share_kind IN ('g', 'c')),
  share_id   TEXT NOT NULL,
  day        DATE NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('view', 'gate', 'preview', 'cta', 'start', 'fork')),
  source     TEXT NOT NULL DEFAULT 'direct',
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (share_kind, share_id, day, event, source)
);
REVOKE ALL ON private.share_stats_daily FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_share_stats_daily_day ON private.share_stats_daily (day);

-- 计数 +1（share-ssr 以服务端身份调用；参数不合法静默忽略，统计永不阻断页面）
CREATE OR REPLACE FUNCTION public.record_share_event(
  p_kind TEXT, p_share_id TEXT, p_event TEXT, p_source TEXT DEFAULT 'direct'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_source TEXT;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('g', 'c') THEN RETURN; END IF;
  IF p_share_id IS NULL OR p_share_id !~ '^[A-Za-z0-9_-]{2,64}$' THEN RETURN; END IF;
  IF p_event IS NULL OR p_event NOT IN ('view', 'gate', 'preview', 'cta', 'start', 'fork') THEN RETURN; END IF;

  v_source := lower(coalesce(p_source, ''));
  IF v_source !~ '^[a-z0-9._-]{1,40}$' THEN v_source := 'direct'; END IF;

  INSERT INTO private.share_stats_daily AS s (share_kind, share_id, day, event, source, count)
  VALUES (p_kind, p_share_id, (now() AT TIME ZONE 'Asia/Shanghai')::date, p_event, v_source, 1)
  ON CONFLICT (share_kind, share_id, day, event, source) DO UPDATE SET count = s.count + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_share_event(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_share_event(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 应用内完成保存（fork）：登录用户调用。仅对仍公开的分享计数，按 uid 限流防刷。
CREATE OR REPLACE FUNCTION public.record_share_fork(p_kind TEXT, p_share_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid TEXT := auth.uid();
BEGIN
  IF v_uid IS NULL OR length(v_uid) = 0 THEN RETURN false; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('g', 'c') THEN RETURN false; END IF;
  IF p_share_id IS NULL OR p_share_id !~ '^[A-Za-z0-9_-]{2,64}$' THEN RETURN false; END IF;

  IF p_kind = 'g' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sibling_groups WHERE id = p_share_id AND is_public = true) THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.public_category_shares WHERE id = p_share_id) THEN
      RETURN false;
    END IF;
  END IF;

  IF public.consume_rate_limit('share-fork:' || v_uid, 30, 3600) IS NOT TRUE THEN
    RETURN false;
  END IF;

  PERFORM public.record_share_event(p_kind, p_share_id, 'fork', 'app');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_share_fork(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_share_fork(TEXT, TEXT) TO authenticated, service_role;

-- 分享者查看自己分享的统计（近 p_days 天，按分享 × 事件汇总）。只返回归属当前用户的分享。
CREATE OR REPLACE FUNCTION public.get_my_share_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE (share_kind TEXT, share_id TEXT, event TEXT, total BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_uid TEXT := auth.uid();
  v_days INTEGER := LEAST(GREATEST(coalesce(p_days, 30), 1), 365);
BEGIN
  IF v_uid IS NULL OR length(v_uid) = 0 THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.share_kind, s.share_id, s.event, sum(s.count)::BIGINT
      FROM private.share_stats_daily s
     WHERE s.day >= (now() AT TIME ZONE 'Asia/Shanghai')::date - v_days
       AND (
         (s.share_kind = 'g' AND EXISTS (
            SELECT 1 FROM public.sibling_groups g WHERE g.id = s.share_id AND g.user_id = v_uid))
         OR
         (s.share_kind = 'c' AND EXISTS (
            SELECT 1 FROM public.public_category_shares c WHERE c.id = s.share_id AND c.user_id = v_uid))
       )
     GROUP BY s.share_kind, s.share_id, s.event;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_share_stats(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_share_stats(INTEGER) TO authenticated, service_role;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
