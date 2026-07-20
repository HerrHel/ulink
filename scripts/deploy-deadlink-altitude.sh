#!/usr/bin/env bash
# 死链检测 altitude 重构部署脚本（#1+#2+#3+#4+#6）
#
# 前置：supabase CLI 已 `supabase login` 且已 link 目标 project
#   （本机已 link yqouglfopbmujkqmjgpu / HerrHel's Project）。
# 本脚本做两件事，幂等可重复跑：
#   1. 对远程库执行 021 迁移：link_check_history 加 fetch_outcome 列 + CHECK 约束
#   2. 部署 check-link Edge Function（index.ts 为唯一受信任实现）
#
# 用法：bash scripts/deploy-deadlink-altitude.sh
# 可重复执行：迁移用 ADD COLUMN IF NOT EXISTS，部署是覆盖式。
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

echo "==> [1/2] 执行 DB 迁移 021（fetch_outcome 列 + CHECK）"
supabase db query --linked < supabase/migrations/021_link_check_history_fetch_outcome.sql

echo "==> [2/2] 部署 check-link Edge Function"
supabase functions deploy check-link --no-verify-jwt

echo "==> 验证：link_check_history 列结构"
supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='link_check_history' ORDER BY ordinal_position;"

echo "==> 完成。请在 client 触发一次死链检测冒烟:观察 link_check_history 新行同时填 fetch_outcome + status,且 bookmarks.attributes 只被 client 写、不被 Edge 写。"
