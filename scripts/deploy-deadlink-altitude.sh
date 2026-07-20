#!/usr/bin/env bash
# 死链检测 follow-up 部署脚本（废弃 status 列 + HEAD→GET 终 URL 重试）
#
# 前置：supabase CLI 已 `supabase login` 且已 link 目标 project
#   （本机已 link yqouglfopbmujkqmjgpu / HerrHel's Project）。
# 顺序（重要）：先 deploy Edge（不再写 status），再 DROP status 列。
#   若先 DROP，旧 Edge 的 insert 会失败；若只 deploy 不 DROP，新 Edge
#   不写 NOT NULL 的 status 也会 insert 失败（history 为 best-effort）。
# 用法：bash scripts/deploy-deadlink-altitude.sh
# 可重复执行：迁移用 IF EXISTS，部署是覆盖式。
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

echo "==> [1/2] 部署 check-link Edge Function（insert 不再含 status）"
supabase functions deploy check-link --no-verify-jwt

echo "==> [2/2] 执行 DB 迁移 022（DROP status 约束 + 列）"
supabase db query --linked < supabase/migrations/022_drop_link_check_history_status.sql

echo "==> 验证：link_check_history 列结构（应无 status，有 fetch_outcome）"
supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='link_check_history' ORDER BY ordinal_position;"

echo "==> 完成。请在 client 触发一次死链检测冒烟："
echo "    新行应有 fetch_outcome + http_status，无 status 列；"
echo "    bookmarks.attributes 只被 client 写、不被 Edge 写。"
