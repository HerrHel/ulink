// 把 supabase/migrations 的 SQL 适配为 CloudBase PG 可执行版本
// 用法: node scripts/transform-migrations.mjs
//
// 适配依据（均已在本机 CloudBase 环境实测确认）：
//   1. auth.uid() 返回 text（JWT sub），不是 uuid
//   2. auth.users(id) 是 bigint，且该表只有 PRIMARY KEY(id)，sub 无唯一约束
//      → 无法用 text 列外键引用它，必须去掉 REFERENCES auth.users(id)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve('supabase/migrations');
const DEST = resolve('cloudbase/migrations');
const BASE_VERSION = '2026102200'; // 前缀，后接 4 位序号 → 合计 14 位

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => parseInt(a.slice(0, 3), 10) - parseInt(b.slice(0, 3), 10));

let converted = 0;
const leftovers = [];

for (const file of files) {
  const seq = file.slice(0, 3).padStart(4, "0");
  const slug = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
  const raw = readFileSync(join(SRC, file), 'utf8');

  let sql = raw;

  // 规则 1：owner 列 UUID + 外键 → TEXT，去掉外键
  //   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
  //   user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  //   user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
  sql = sql.replace(
    /(\b[a-zA-Z_][\w]*)\s+UUID(\s+NOT NULL|\s+PRIMARY KEY)?\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)(\s+ON\s+DELETE\s+(?:CASCADE|SET NULL|RESTRICT|NO ACTION))?/gi,
    (_m, col, constraint) => `${col} TEXT${constraint ? constraint.replace(/\s+/g, ' ') : ''}`
  );

  // 规则 2：残留的任何 auth.users 外键引用（其他写法）
  sql = sql.replace(/REFERENCES\s+auth\.users\s*\(\s*id\s*\)(\s+ON\s+DELETE\s+\w+(\s+\w+)?)?/gi, '');

  // 规则 3：plpgsql 里承接 auth.uid() 的变量类型 uuid → text
  sql = sql.replace(/\b(g_user_id|v_uid|v_user_id)\s+uuid\b/gi, '$1 text');

  // 规则 4：uuid-ossp 未必可用，改用内置 gen_random_uuid()（PG13+ 内置）
  sql = sql.replace(/uuid_generate_v4\s*\(\s*\)/gi, 'gen_random_uuid()');

  // 规则 5：既然不再用 uuid_generate_v4()，就不必创建 uuid-ossp 扩展（避免权限问题）
  sql = sql.replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"uuid-ossp"\s*;\s*\n?/gi, '');

  const header = [
    `-- 源文件: supabase/migrations/${file}`,
    `-- CloudBase PG 适配: auth.uid() 返回 text；owner 列 UUID→TEXT 且移除 auth.users 外键`,
    '',
  ].join('\n');

  const out = `${BASE_VERSION}${seq}_${slug}.sql`;
  writeFileSync(join(DEST, out), header + sql, 'utf8');
  converted += 1;

  // 收集残留 uuid 以便人工复核
  sql.split('\n').forEach((line, i) => {
    if (/\buuid\b/i.test(line) && !/gen_random_uuid|--/.test(line)) {
      leftovers.push(`${out}:${i + 1}: ${line.trim()}`);
    }
  });
}

console.log(`已生成 ${converted} 个迁移 → ${DEST}`);
if (leftovers.length) {
  console.log(`\n残留 uuid 引用（需人工确认）${leftovers.length} 处：`);
  for (const l of leftovers) console.log('  ' + l);
}
