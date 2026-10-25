-- 免费版额度调整：补上"升级钩子"
--
-- 背景（见 docs/PRICING.md §3）：原 free 套餐**不含**死链检测与视频解析，
-- 用户完全看不出 Plus 的价值在哪，缺少"用上了、想要更多"的转化路径。
--
-- 成本核算（100 活跃用户/月）：
--   free 每天 3 次死链检测 × 2s × 256MB ≈ 0.5 点/天 → 约 1,500 点/月（可忽略）
--   free 每天 1 次视频解析 ≈ 0.2 点/天
--   storage 从 50MB 提到 200MB、ai.tokens 从 20,000 提到 50,000
--     → AI 成本仍为每用户每月 ¥0.06 量级
-- 结论：这些额度的成本在噪声级别，但能显著提升免费版的完整体验与付费转化。
--
-- 注意：本次**只动 free 档**，plus 档权益保持不变（已对外承诺的权益不得缩水）。
-- 免费额度不写入法律文档的具体数字（政策只写「不设自动过期」等定性表述），
-- 额度是纯运营参数，可随时调整。

BEGIN;

UPDATE public.plans
   SET features = features || jsonb_build_object(
         'storage.bytes',      209715200,   -- 200MB
         'sync.devices',       2,
         'ai.tokens.monthly',  50000,
         'linkcheck.daily',    3,
         'video.extract.daily', 1,
         'history.days',       90
       ),
       updated_at = now()
 WHERE id = 'free';

-- 兜底：免费档绝不能出现自动全量检测（成本与书签数成正比）
UPDATE public.plans
   SET features = features - 'linkcheck.auto',
       updated_at = now()
 WHERE id = 'free';

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(id, ',') INTO v_bad
    FROM public.plans
   WHERE features ? 'share' OR features ? 'publish' OR features ? 'exposure' OR features ? 'seo';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '非法收费域检测到 share/publish/exposure/seo：%', v_bad;
  END IF;
END $$;

COMMIT;
