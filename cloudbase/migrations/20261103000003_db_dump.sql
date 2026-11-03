-- 数据库全量快照 RPC：供 maintenance 每日导出备份使用
--
-- 背景：CloudBase 个人版的 PostgreSQL 跑在共享集群上，
-- 控制台「备份」页明确提示「当前共享集群暂不提供相关能力」（2026-11-03 核实），
-- 而《安全评估自评估报告》承诺「提供云端数据备份用于取证」。
-- 升级独享集群只为备份不划算，故自建：每日把全部业务表导出为 JSON 存云存储。
--
-- 数据量：当前全库 <1MB（bookmarks 248 行 × ~560B、data_history 258 行），
-- 单次调用一次性返回 jsonb 完全可行；若未来超限，改为按表分批导出即可。

CREATE OR REPLACE FUNCTION public.fn_dump_all_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- 硬编码表清单（不含 storage/auth 等平台 schema），用 %I 格式化防注入
  v_tables text[] := ARRAY[
    'plans', 'bookmarks', 'categories', 'sibling_groups', 'custom_attributes',
    'data_history', 'deleted_item_graveyard', 'entitlements', 'usage_ledger',
    'orders', 'error_logs', 'link_check_history', 'feedback_messages',
    'public_category_shares', 'user_security', 'legacy_identity_map', 'audit_log'
  ];
  v_table   text;
  v_rows    jsonb;
  v_tables_json jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(x), ''[]''::jsonb) FROM public.%I x', v_table)
      INTO v_rows;
    v_tables_json := v_tables_json || jsonb_build_object(v_table, v_rows);
  END LOOP;

  RETURN jsonb_build_object(
    'version', 1,
    'exported_at', now(),
    'row_counts', (
      SELECT jsonb_object_agg(key, jsonb_array_length(value))
      FROM jsonb_each(v_tables_json)
    ),
    'tables', v_tables_json
  );
END;
$$;

-- 仅服务端可调用（maintenance 云函数经 service_role）；客户端零访问
REVOKE ALL ON FUNCTION public.fn_dump_all_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dump_all_tables() TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
