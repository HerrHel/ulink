-- 死链「自动全量检测」设为 Plus 专属
--
-- 背景：死链检测有两条路径，成本差一个量级——
--   手动检查：用户点一次，检查一次（有界）
--   自动检测：每周一次**全量**扫描所有书签，请求数与书签数成正比（无界）
-- 之前两者都免费且不受 features 约束 —— 1000 个书签的用户 = 每周 1000 次服务端外呼，
-- 成本随用户数线性增长，是最大的成本敞口。
--
-- 处理：把「自动全量检测」纳入套餐，用 linkcheck.auto 开关控制。
--   free  → 无 linkcheck.auto（只能手动检查）
--   plus  → linkcheck.auto = 1
-- 手动检查保持所有用户可用（体验不阉割），外呼频次由 check-link 云函数既有 IP 限流兜底。
--
-- 收费点落位原则：把收费点放在**有真实外部成本**的项上（外呼、存储），
-- 而不是成本近乎为零的 token 额度上（见 BILLING_OPS.md §4 成本测算）。

BEGIN;

-- Plus 档：解锁自动全量检测
UPDATE public.plans
   SET features = features || jsonb_build_object('linkcheck.auto', 1),
       updated_at = now()
 WHERE id IN ('plus_monthly', 'plus_yearly');

-- 免费档：明确不含（同时兜住未来误加）
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
