-- 源文件: supabase/migrations/006_enable_realtime.sql
-- CloudBase 适配: **no-op**
--
-- 原文件把 4 张业务表加入 Supabase 的 `supabase_realtime` publication。
-- CloudBase PG 不提供该 publication（实测 pg_publication 为空，
-- 且 PG 模式下没有等价于 supabase-js `postgres_changes` 的订阅通道）。
--
-- 现状：目标库 wal_level = logical，基础设施层面具备逻辑复制能力，
-- 但 CloudBase 未开放 PG 变更订阅接口。
-- 因此 useSyncRealtime 在 CloudBase 上降级为「可见性/在线时轮询 + 本地幂等合并」，
-- syncMergeCore 的合并逻辑无需改动（本身幂等）。
--
-- 若 CloudBase 后续开放实时推送，在此补回对应 DDL 即可。

SELECT 1;
