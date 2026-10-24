-- 收费数据层：套餐 / 权益 / 订单 / 用量账本 + 配额函数
--
-- 定位：**只建表不启用**。本迁移不改变任何现有功能，也不拦截任何请求；
-- 影子计量阶段（见 BILLING_DESIGN.md §9 Phase 1）只写 usage_ledger，不做额度判断。
--
-- 设计约束（改动前请先读 BILLING_DESIGN.md §2~§6.1）：
-- 1) uid 全链路按 **string** 处理：JWT sub 是 19 位 bigint 字符串，超出 JS 安全整数，
--    任何 Number()/parseInt 都会精度丢失并把不同用户折叠成同一个；
-- 2) 权益只有一个真相来源：entitlements + plans，由**支付回调**写入，客户端永不可写；
-- 3) 有效期由 expires_at + 服务端 now() **算出来**，不依赖「取消订阅」回调（回调会丢）；
-- 4) 账本 append-only：结算用**冲正行**（settle），绝不 UPDATE 原记录，否则无法对账；
-- 5) 并发防双花：reserve_quota 内用 pg_advisory_xact_lock 串行化 (uid,metric,period)；
-- 6) 收费点只允许 ai/storage/sync/history/linkcheck/video 六类，
--    **禁止 share/publish/exposure/seo** —— 一旦出现分享类限制，产品即变成
--    「付费购买对公众发布信息的能力」，「自营软件服务」的合规定性会崩塌。

BEGIN;

-- ── 1. 套餐 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'CNY',
  period_days   INTEGER CHECK (period_days IS NULL OR period_days > 0),
  features      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 焊死「分享类不得作为付费点」：JSON 文本正则匹配顶层 key（如 "share.max"）
  CONSTRAINT plans_features_no_share
    CHECK (features::text !~* '"(share|publish|exposure|seo)[^"]*"\s*:')
);

COMMENT ON TABLE public.plans IS
  '套餐定义。features 键格式 `域.指标.周期`，值一律为数字；键不存在或 ≤0 = 该能力不开放。';

-- ── 2. 用户权益（一个 user 至多一行）───────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id           TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES public.plans(id),
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','grace','expired','refunded')),
  feature_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  source            TEXT NOT NULL DEFAULT 'order'
                      CHECK (source IN ('order','redeem','manual','trial')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.entitlements IS
  '用户当前权益。只由验签后的支付回调写入（service_role）；有效期以 expires_at + 服务端 now() 计算。';

-- ── 3. 订单（幂等）──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id               TEXT PRIMARY KEY,          -- 显式 randomUUID：CloudBase .insert() 不回填
  user_id          TEXT NOT NULL,
  plan_id          TEXT NOT NULL REFERENCES public.plans(id),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0),  -- 整数分，禁 float
  currency         TEXT NOT NULL DEFAULT 'CNY',
  channel          TEXT NOT NULL
                     CHECK (channel IN ('wechat','alipay','stripe','paddle','redeem','manual')),
  channel_order_id TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','failed','refunded')),
  idempotency_key  TEXT NOT NULL UNIQUE,      -- 渠道会重发回调（微信最多 8 次）
  paid_at          TIMESTAMPTZ,
  raw_callback     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel_order ON public.orders (channel, channel_order_id);

COMMENT ON TABLE public.orders IS
  '支付订单。idempotency_key 唯一约束是防重复发货的最后一道闸。';

-- ── 4. 用量账本（append-only）───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  metric     TEXT NOT NULL,          -- ai.tokens / storage.bytes / ...
  amount     NUMERIC NOT NULL,       -- 正=消耗，负=结算冲正或退还
  ref        TEXT,                   -- 请求 id，settle 时定位
  period     TEXT NOT NULL,          -- '2026-10'，按 Asia/Shanghai 分桶
  kind       TEXT NOT NULL DEFAULT 'reserve'
               CHECK (kind IN ('reserve','settle','refund')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user_metric_period
  ON public.usage_ledger (user_id, metric, period);
CREATE INDEX IF NOT EXISTS idx_usage_ref ON public.usage_ledger (ref);

COMMENT ON TABLE public.usage_ledger IS
  '用量账本：只增不改。结算写 kind=settle 的冲正行；退款写 kind=refund 的负数行。';

-- ── 5. 权益解析（唯一读入口）────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_entitlement(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.entitlements%ROWTYPE;
  v_f jsonb;
BEGIN
  -- 无记录 = 免费版
  SELECT * INTO v_e FROM public.entitlements WHERE user_id = p_uid;
  IF NOT FOUND THEN
    SELECT features INTO v_f FROM public.plans WHERE id = 'free';
    RETURN jsonb_build_object(
      'plan_id', 'free', 'status', 'active',
      'features', coalesce(v_f, '{}'::jsonb)
    );
  END IF;

  SELECT (p.features || coalesce(v_e.feature_overrides, '{}'::jsonb)) INTO v_f
    FROM public.plans p WHERE p.id = v_e.plan_id;

  -- 过期只看服务端 now() + expires_at：靠「取消回调」降级会在回调丢失时白送权益
  RETURN jsonb_build_object(
    'plan_id',    v_e.plan_id,
    'status',     CASE WHEN v_e.expires_at IS NOT NULL AND v_e.expires_at < now()
                       THEN 'expired' ELSE v_e.status END,
    'expires_at', v_e.expires_at,
    'features',   coalesce(v_f, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_entitlement(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_entitlement(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_entitlement(text) IS
  '返回用户权益快照 {plan_id,status,expires_at,features}。免费版由 plans.id=free 兜底。';

-- ── 6. 配额预扣（原子）──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_quota(
  p_uid    text,
  p_metric text,
  p_amount numeric,
  p_period text,
  p_ref    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feat  jsonb;
  v_limit numeric;
  v_used  numeric;
BEGIN
  IF p_uid IS NULL OR p_metric IS NULL OR p_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  -- 并发防双花：同一 (uid,metric,period) 串行化，
  -- 否则两个并发请求都读到 used=limit-1 会各自通过校验
  PERFORM pg_advisory_xact_lock(hashtext(p_uid || ':' || p_metric || ':' || p_period));

  v_feat  := public.resolve_entitlement(p_uid) -> 'features';
  v_limit := coalesce((v_feat ->> p_metric)::numeric, 0);

  IF v_limit <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_plan', 'metric', p_metric);
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_used
    FROM public.usage_ledger
   WHERE user_id = p_uid AND metric = p_metric AND period = p_period;

  IF v_used + p_amount > v_limit THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'quota_exceeded',
      'used', v_used, 'limit', v_limit, 'metric', p_metric
    );
  END IF;

  INSERT INTO public.usage_ledger (user_id, metric, amount, ref, period, kind)
  VALUES (p_uid, p_metric, p_amount, p_ref, p_period, 'reserve');

  RETURN jsonb_build_object('ok', true, 'used', v_used + p_amount, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quota(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(text, text, numeric, text, text) TO service_role;

COMMENT ON FUNCTION public.reserve_quota(text, text, numeric, text, text) IS
  '按额度预扣。超额返回 {ok:false,reason:quota_exceeded}，绝不抛错。仅 service_role 可调用（客户端不得自刷额度）。';

-- ── 7. 配额结算（只追加冲正行）──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_quota(
  p_ref    text,
  p_actual numeric,
  p_period text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.usage_ledger%ROWTYPE;
BEGIN
  IF p_ref IS NULL OR p_actual IS NULL THEN RETURN; END IF;

  -- 幂等：同一 ref 只结算一次，重复调用直接返回（避免重复冲正）
  IF EXISTS (SELECT 1 FROM public.usage_ledger WHERE ref = p_ref AND kind = 'settle') THEN
    RETURN;
  END IF;

  SELECT * INTO v_row
    FROM public.usage_ledger
   WHERE ref = p_ref AND kind = 'reserve'
   ORDER BY id DESC LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  -- 冲正行：actual - reserved（可为正也可为负）
  INSERT INTO public.usage_ledger (user_id, metric, amount, ref, period, kind)
  VALUES (v_row.user_id, v_row.metric, p_actual - v_row.amount, p_ref, p_period, 'settle');
END;
$$;

REVOKE ALL ON FUNCTION public.settle_quota(text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_quota(text, numeric, text) TO service_role;

COMMENT ON FUNCTION public.settle_quota(text, numeric, text) IS
  '按实际用量结算：追加 kind=settle 冲正行（不 UPDATE 原记录）。重复调用幂等。';

-- ── 8. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger  ENABLE ROW LEVEL SECURITY;

-- 套餐是公开信息，任何人可读
DROP POLICY IF EXISTS "Anyone can read plans" ON public.plans;
CREATE POLICY "Anyone can read plans" ON public.plans FOR SELECT USING (true);

-- 其余三表：用户仅可读自己的；写入一律不给（只由 service_role / SECURITY DEFINER 函数写）
DROP POLICY IF EXISTS "Users can read own entitlement" ON public.entitlements;
CREATE POLICY "Users can read own entitlement" ON public.entitlements
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own orders" ON public.orders;
CREATE POLICY "Users can read own orders" ON public.orders
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read own usage" ON public.usage_ledger;
CREATE POLICY "Users can read own usage" ON public.usage_ledger
  FOR SELECT USING (user_id = auth.uid());

-- ── 9. 种子数据 ──────────────────────────────────────────────────────
-- 免费额度是占位值：须等影子计量跑满两周、拿到 P50/P95 后再校准（BILLING_DESIGN.md §9）
INSERT INTO public.plans (id, name, price_cents, currency, period_days, features) VALUES
('free', '免费版', 0, 'CNY', NULL,
 '{"ai.tokens.monthly":20000,"storage.bytes":52428800,"sync.devices":1,"history.days":30}'),
('plus_monthly', 'Plus 月付', 1200, 'CNY', 30,
 '{"ai.tokens.monthly":200000,"ai.requests.daily":100,"storage.bytes":5368709120,"sync.devices":3,"history.days":90,"linkcheck.daily":50,"video.extract.daily":10}'),
('plus_yearly', 'Plus 年付', 10800, 'CNY', 365,
 '{"ai.tokens.monthly":200000,"ai.requests.daily":100,"storage.bytes":5368709120,"sync.devices":3,"history.days":90,"linkcheck.daily":50,"video.extract.daily":10}')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      price_cents = EXCLUDED.price_cents,
      currency = EXCLUDED.currency,
      period_days = EXCLUDED.period_days,
      features = EXCLUDED.features,
      active = true,
      updated_at = now();

-- ── 8. 用量记录（影子计量）──────────────────────────────────────────
-- 单独提供 RPC 而非让云函数直写：usage_ledger 开了 RLS + FORCE RLS，
-- 直写会因策略受限而失败；SECURITY DEFINER + 仅 service_role 授权最稳。
-- 影子阶段（不改用户可见行为）只累加、不拦截，因此不需要 reserve。
CREATE OR REPLACE FUNCTION public.record_usage(
  p_uid    text,
  p_metric text,
  p_amount numeric,
  p_ref    text,
  p_period text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_uid IS NULL OR p_metric IS NULL OR p_amount IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.usage_ledger (user_id, metric, amount, ref, period, kind)
  VALUES (p_uid, p_metric, p_amount, p_ref, coalesce(p_period, 'unknown'), 'reserve');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_usage(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_usage(text, text, numeric, text, text) TO service_role;

COMMENT ON FUNCTION public.record_usage(text, text, numeric, text, text) IS
  '仅 service_role：影子计量用——只累加用量，不做额度判断，不影响用户可见行为。';

COMMIT;
