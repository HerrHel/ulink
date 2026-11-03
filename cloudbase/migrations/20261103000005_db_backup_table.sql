-- 数据库备份表 + 一键备份 RPC
--
-- 背景：CloudBase 个人版 PG 在共享集群，平台备份不可用（控制台明确提示）；
-- 且 PG 环境下的 node-sdk 不支持 uploadFile（STORAGE_NOT_SUPPORTED），
-- 无法上传到云存储。故把每日全量快照直接落库到 db_backup 表：
--   · 零外部依赖，一个 RPC 完成导出 + 入库 + 轮转
--   · 防误操作/程序缺陷（用户误删、代码 bug 批量删数据）——这正是共享集群缺的那层保护
--   · 可随时用 SELECT 取出 payload 恢复到任意环境
--
-- 保留策略：默认 30 天，由 fn_create_db_backup 内部轮转。

CREATE TABLE IF NOT EXISTS public.db_backup (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day        date NOT NULL UNIQUE,          -- 北京时区日期，同一天覆盖
  created_at timestamptz NOT NULL DEFAULT now(),
  bytes      integer NOT NULL,
  row_counts jsonb,
  payload    jsonb NOT NULL
);

REVOKE ALL ON public.db_backup FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_create_db_backup(p_keep_days INTEGER DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dump  jsonb;
  v_text  text;
  v_day   date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_bytes integer;
  v_purged integer := 0;
BEGIN
  v_dump := public.fn_dump_all_tables();
  v_text := v_dump::text;
  v_bytes := length(v_text);

  INSERT INTO public.db_backup (day, bytes, row_counts, payload)
  VALUES (v_day, v_bytes, v_dump -> 'row_counts', v_dump)
  ON CONFLICT (day) DO UPDATE
    SET created_at = now(),
        bytes = EXCLUDED.bytes,
        row_counts = EXCLUDED.row_counts,
        payload = EXCLUDED.payload;

  -- 轮转：保留最近 p_keep_days 天
  DELETE FROM public.db_backup
   WHERE day < v_day - GREATEST(COALESCE(p_keep_days, 30), 1);

  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'day', v_day,
    'bytes', v_bytes,
    'row_counts', v_dump -> 'row_counts',
    'purged', v_purged,
    'kept', (SELECT count(*) FROM public.db_backup)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_db_backup(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_db_backup(INTEGER) TO service_role;

-- 备份清单查询（监管/运维核对用；不含 payload，避免误拉大对象）
CREATE OR REPLACE FUNCTION public.list_db_backups(p_limit INTEGER DEFAULT 30)
RETURNS TABLE (day date, created_at timestamptz, bytes integer, row_counts jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.day, b.created_at, b.bytes, b.row_counts
  FROM public.db_backup b
  ORDER BY b.day DESC
  LIMIT GREATEST(COALESCE(p_limit, 30), 1)
$$;

REVOKE ALL ON FUNCTION public.list_db_backups(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_db_backups(INTEGER) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
