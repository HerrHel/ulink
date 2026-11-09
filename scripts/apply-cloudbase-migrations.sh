#!/usr/bin/env bash
# 一次性应用 cloudbase/_pending 下的全部迁移（migration up 本身会应用所有 pending）
# 用法: bash scripts/apply-cloudbase-migrations.sh [envId]
# 错误即停：旧版只有 set -u，中间步骤失败/管道被吞仍会继续，补 -e -o pipefail
set -euo pipefail
ENV="${1:-ulink-d1g5srvjo54b1886a}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PENDING="$ROOT/cloudbase/_pending"
ACTIVE="$ROOT/cloudbase/migrations"

# 用 nullglob 直接取文件数组，避免 ls 分词；无文件时数组为空不报错
shopt -s nullglob
files=( "$PENDING"/*.sql )
shopt -u nullglob
total=${#files[@]}
echo "待应用: $total 个"

if [ "$total" -eq 0 ]; then
  echo "无待应用迁移"
  exit 0
fi

# 文件移动仅作记录：migration up 一次应用全部 pending，不能按文件循环调用
# （旧版每个文件调一次，第 2 次起必判 FAILED，还把已成功文件又移回 _pending）
for f in "${files[@]}"; do
  echo "──────── 记录: $(basename "$f")"
  mv "$f" "$ACTIVE/"
done

# 一次性调用 migration up；命令非零退出直接判失败
if ! out=$(cd "$ROOT" && tcb db pg migration up -e "$ENV" 2>&1); then
  echo "  FAILED ── migration up 命令非零退出"
  echo "$out" | tail -25
  exit 1
fi
echo "$out"

# 判据：必须命中带锚定的成功标记「√ migration up completed」，且输出不含 FAILED/Error
# 旧版 grep -q "migration up completed" 无锚定，错误文本里带同样字样也会误判成功
if grep -qE '^[[:space:]]*√ migration up completed' <<< "$out" && ! grep -qE 'FAILED|Error' <<< "$out"; then
  echo "全部 $total 个迁移应用完成"
else
  echo "  FAILED ── 未命中锚定成功标记，或输出含 FAILED/Error"
  echo "$out" | tail -25
  exit 1
fi
