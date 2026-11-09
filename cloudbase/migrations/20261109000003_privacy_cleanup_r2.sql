-- 第二轮深审数据库加固 2/3（2026-11-09）：注销清库 / 备份快照 / 同日恢复点
-- ① purge_user_data 漏删 data_history / graveyard / audit_log / legacy_identity_map /
--    private.*，且 db_backup.payload 是全库明文快照，注销后仍留存 30 天
-- ② fn_create_db_backup 的 ON CONFLICT DO UPDATE 会让同日重跑覆盖 03:00 的好备份

BEGIN;

-- 从历史全库快照中按 user_id / uid / cb_sub 擦除已注销用户的行
CREATE OR REPLACE FUNCTION private.purge_backup_rows_for_user(p_uid text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  v_rec record; v_tbl text; v_arr jsonb; v_rows jsonb; v_payload jsonb;
BEGIN
  FOR v_rec IN SELECT id, payload FROM public.db_backup LOOP
    v_payload := v_rec.payload;
    IF coalesce(jsonb_typeof(v_rec.payload -> 'tables'), '') <> 'object' THEN CONTINUE; END IF;
    FOR v_tbl IN SELECT jsonb_object_keys(v_rec.payload -> 'tables') LOOP
      v_arr := coalesce(v_rec.payload -> 'tables' -> v_tbl, '[]'::jsonb);
      IF jsonb_typeof(v_arr) <> 'array' THEN CONTINUE; END IF;
      SELECT coalesce(jsonb_agg(e.value), '[]'::jsonb) INTO v_rows
        FROM jsonb_array_elements(v_arr) AS e(value)
       WHERE NOT (coalesce(e.value ->> 'user_id', '') = p_uid
               OR coalesce(e.value ->> 'uid', '') = p_uid
               OR coalesce(e.value ->> 'cb_sub', '') = p_uid);
      v_payload := jsonb_set(v_payload, ARRAY['tables', v_tbl], v_rows, false);
    END LOOP;
    UPDATE public.db_backup SET payload = v_payload WHERE id = v_rec.id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.purge_backup_rows_for_user(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_user_data(p_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
AS $$
DECLARE
  v_ledger integer := 0; v_orders integer := 0; v_bm integer := 0;
  v_grp integer := 0; v_cat integer := 0; v_attr integer := 0;
  v_sec integer := 0; v_logs integer := 0; v_check integer := 0;
  v_share integer := 0; v_extra integer := 0;
BEGIN
  IF p_uid IS NULL OR length(trim(p_uid)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  DELETE FROM public.usage_ledger WHERE user_id = p_uid; GET DIAGNOSTICS v_ledger = ROW_COUNT;
  DELETE FROM public.orders WHERE user_id = p_uid; GET DIAGNOSTICS v_orders = ROW_COUNT;
  DELETE FROM public.entitlements WHERE user_id = p_uid;
  DELETE FROM public.link_check_history WHERE user_id = p_uid; GET DIAGNOSTICS v_check = ROW_COUNT;
  DELETE FROM public.error_logs WHERE user_id = p_uid; GET DIAGNOSTICS v_logs = ROW_COUNT;
  DELETE FROM public.public_category_shares WHERE user_id = p_uid; GET DIAGNOSTICS v_share = ROW_COUNT;
  DELETE FROM public.custom_attributes WHERE user_id = p_uid; GET DIAGNOSTICS v_attr = ROW_COUNT;
  DELETE FROM public.user_security WHERE user_id = p_uid; GET DIAGNOSTICS v_sec = ROW_COUNT;
  DELETE FROM public.bookmarks WHERE user_id = p_uid; GET DIAGNOSTICS v_bm = ROW_COUNT;
  DELETE FROM public.sibling_groups WHERE user_id = p_uid; GET DIAGNOSTICS v_grp = ROW_COUNT;
  DELETE FROM public.categories WHERE user_id = p_uid; GET DIAGNOSTICS v_cat = ROW_COUNT;

  -- 本轮补齐：历史版本、墓碑、审计、身份映射、退款幂等凭证、限流计数
  DELETE FROM public.data_history WHERE user_id = p_uid;
  DELETE FROM public.deleted_item_graveyard WHERE user_id = p_uid;
  DELETE FROM public.audit_log WHERE uid = p_uid;
  DELETE FROM public.legacy_identity_map WHERE cb_sub = p_uid OR legacy_uuid = p_uid;
  DELETE FROM private.deep_quota_refunds WHERE uid = p_uid;
  DELETE FROM private.rate_limit_counters WHERE key LIKE '%' || p_uid || '%';
  GET DIAGNOSTICS v_extra = ROW_COUNT;
  PERFORM private.purge_backup_rows_for_user(p_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'usage_ledger', v_ledger, 'orders', v_orders, 'bookmarks', v_bm,
      'sibling_groups', v_grp, 'categories', v_cat, 'custom_attributes', v_attr,
      'user_security', v_sec, 'error_logs', v_logs, 'link_check_history', v_check,
      'public_category_shares', v_share, 'rate_limit_counters', v_extra,
      'db_backup_rows_purged', true
    ),
    'at', now()
  );
END;
$$;

-- 同日已有备份即跳过：避免白天误删后手工重跑把 03:00 的好恢复点覆盖
CREATE OR REPLACE FUNCTION public.fn_create_db_backup(p_keep_days INTEGER DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dump jsonb; v_text text; v_day date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_bytes integer; v_purged integer := 0; v_inserted integer := 0;
BEGIN
  v_dump := public.fn_dump_all_tables();
  v_text := v_dump::text;
  v_bytes := length(v_text);

  INSERT INTO public.db_backup (day, bytes, row_counts, payload)
  VALUES (v_day, v_bytes, v_dump -> 'row_counts', v_dump)
  ON CONFLICT (day) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  DELETE FROM public.db_backup WHERE day < v_day - GREATEST(COALESCE(p_keep_days, 30), 1);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'day', v_day, 'bytes', v_bytes,
    'inserted', v_inserted, 'row_counts', v_dump -> 'row_counts',
    'purged', v_purged, 'kept', (SELECT count(*) FROM public.db_backup)
  );
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
