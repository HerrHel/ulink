# CLI 已归档（2026-10-31）

## 结论

`cli/` 子项目已于 2026-10-31 从活跃代码树移除。原因：

1. **没有用户触达路径**：未发布 npm、站点无下载入口、文档无入口；产品定位是"零基础零成本直接用网站"，用户不可能获得 CLI。
2. **与生产后端脱节**：依赖 `@supabase/supabase-js` 指向 Supabase，而生产 2026-10-22 已全量迁 CloudBase；连上只能读到迁移前的历史数据。
3. **纯维护成本**：独立依赖树与 tsconfig、测试被主 vitest 扫入、依赖不进根 `npm audit`（审计盲区）、文档与 agent 需要额外解释"已过时勿用"。
4. 若未来确实需要批量/自动化能力，更合理的方向是 **MCP Server / 开放 API**，而不是要求用户本地装 Node 的 CLI。

## 如何找回

代码完整保留在 git 历史中（移除前最后提交 `6cf8783`）：

```bash
# 查看
git show 6cf8783:cli/package.json

# 恢复到临时目录
git worktree add ../ulink-cli-archive 6cf8783
# 或只恢复 cli 目录
git checkout 6cf8783 -- cli
```

若将来恢复，需先完成：适配 CloudBase、定义分发渠道、补 `npm audit` 覆盖与发布流程。

## 已同步更新的引用

- `AGENTS.md` / `CLAUDE.md` 的 CLI 段落改为"已归档"说明
- `.gitignore` 移除了 `!/cli/README.md` 白名单
- 主 `vitest` 不再扫描 `cli/src/__tests__/`
