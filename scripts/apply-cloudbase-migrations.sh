#!/usr/bin/env bash
# 逐个应用 cloudbase/_pending 下的迁移，遇到失败立即停止并保留现场
# 用法: bash scripts/apply-cloudbase-migrations.sh [envId]
set -u
ENV="${1:-ulink-d1g5srvjo54b1886a}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PENDING="$ROOT/cloudbase/_pending"
ACTIVE="$ROOT/cloudbase/migrations"

total=$(ls "$PENDING"/*.sql 2>/dev/null | wc -l)
echo "待应用: $total 个"

n=0
for f in $(ls "$PENDING"/*.sql 2>/dev/null | sort); do
  base=$(basename "$f")
  mv "$f" "$ACTIVE/"
  n=$((n+1))
  echo "──────── [$n/$total] $base"
  out=$(cd "$ROOT" && tcb db pg migration up -e "$ENV" 2>&1)
  # 注意：不能用 "submitted successfully" 判成功——任务提交成功但执行失败时也会打印它。
  # 唯一可靠的成功标记是 "√ migration up completed"。
  if echo "$out" | grep -q "migration up completed"; then
    echo "  OK"
  else
    echo "  FAILED ── 回退该文件到 _pending 并停止"
    echo "$out" | tail -25
    mv "$ACTIVE/$base" "$PENDING/"
    exit 1
  fi
done

echo "全部 $total 个迁移应用完成"
