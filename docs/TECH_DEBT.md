# LinkVault 技术债清单

> 扫描于 2026-08-17，基于 `src/` 源码静态分析。
> 重要澄清：此前统计的「106 处 TODO」为**误报**——正则把恢复密钥占位符 `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` 里的 `XXX` 当成了 HACK 标记，加上测试文件里的同类占位符。源码内**没有任何真实的 TODO/FIXME/HACK 注释**。

## 一、先排除的误报（非技术债）

| 项目 | 真实情况 |
|------|----------|
| 源码 TODO/FIXME/HACK | **0 处**（仅 `ai-classify.ts` 关键词列表含 "todo" 字面；非待办） |
| 源码 `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` | **0 处**（14 处全在测试文件） |
| 源码 `console.log`/`debugger` | **0 处**（1 处在 `src/__tests__/search.test.ts:274` 基准日志，测试内） |
| 违反「禁止 var」规范 | **0 处** |
| 测试内 `any` 1577 处 / `@ts-` 14 处 | 测试桩代码，不影响产品类型安全，**不算产品债** |

## 二、真正的技术债（按优先级）

### A. 可维护性：巨型模块（最高优先级）
集中了大部分业务逻辑，改动风险高、单测庞大。

| 文件 | 行数 | 职责 | 建议拆分方向 |
|------|------|------|--------------|
| `src/stores/data.ts` | 1086 | 书签/组/分类/属性 CRUD + 过滤 + 排序（上帝 Store） | 按实体拆 `bookmarkStore`/`groupStore`/`categoryStore`；过滤排序抽纯函数 |
| `src/composables/domain/useE2E.ts` | 825 | E2E 加密/解密/迁移 | 加解密纯函数 vs 状态编排分离 |
| `src/composables/domain/useDeadLinkChecker.ts` | 724 | 死链检测（批量/节流/网络） | 网络探活、批量调度、结果处理分层 |
| `src/composables/domain/useDataIO.ts` | 653 | 导入/导出 | 格式解析 vs 持久化写入分离 |
| `src/composables/domain/useBookmark.ts` | 639 | 书签业务逻辑 | 去重/规范化/图标派生可抽纯函数 |
| `src/composables/interaction/useDragDrop.ts` | 588 | 拖拽排序 | 通用 DnD 内核 vs 业务绑定分离 |

### B. 类型安全缺口：源码 `any` 共 33 处
多数出现在「外部无类型边界」（Supabase 行、TipTap 编辑器、DOM 引用），风险中等偏低，但建议逐步收紧。

- **同步子系统（约 15 处）**：`syncPull.ts:48,56` / `syncPush.ts:197,207,241` / `syncRemotePort.ts:49,58` / `useSyncRealtime.ts:36,130,132,159,170,188,205,226,267` / `useSyncMapping.ts:284`（`FROM_REMOTE` 类型）— 远程行映射用 `any`，可用 `z.infer` 出的远端类型替代。
- **编辑器集成**：`lib/editor.ts:44`（`level as any`）、`components/editor/GroupEditor.vue:194`（`(editor as any)._lvGid`）。
- **DOM 引用**：`GroupCard.vue:139` / `MentionDropdown.vue:53` / `useInlineRename.ts:13` / `useMobileDragReorder.ts:85`。
- **存储/状态**：`stores/storage.ts:12,67`（`value: any`）、`stores/app.ts:67`（`(ui() as any)`）。
- **错误上报**：`lib/errorReporter.ts:136,151`。

### C. 外部服务硬编码 / 魔法字符串（中优先级）
换部署、换供应商或区域网络异常时会暴露问题，且部分涉及隐私。

| 位置 | 硬编码内容 | 风险 |
|------|-----------|------|
| `src/utils.ts:68` + `src/config/welcome-data.ts:37-41,116-117` | `https://api.xinac.net/icon/?url=` 第三方 favicon | 单点故障 + **隐私**（每个书签域名泄露给第三方） |
| `src/composables/domain/useBookmark.ts:577` | `https://www.google.com/s2/favicons?domain=` | Google favicon 服务，区域可用性不稳定 |
| `src/composables/domain/useDeadLinkChecker.ts:140-142` | 探活 URL 写死 baidu/gstatic generate_204/cloudflare | 换环境/区域可能失效 |
| `src/views/ShareView.vue` `backToApp` / `onUnmounted` | canonical 原写死 `https://herrhel.github.io/` → 已收口为 `APP_CANONICAL_BASE`（`src/config/urls.ts:25` = `https://ulink.ren/`） | 已解决：换域名只改一处常量 |

**建议**：抽到 `src/config/constants.ts` 统一为常量，favicon 源做成可配置 + 带本地降级（data URI / 首字母占位）。

### D. ShareView.vue 三处非阻塞观察（低优先级）
审计结论：边界处理已很扎实，**无需紧急修复**。
1. 错误态只有「返回首页」，无「重试」按钮（瞬断需刷新页面）。
2. `get_public_group` RPC 调用无 fetch 超时（后端挂起则一直转圈）。
3. canonical 硬编码（已列入 C）。

### E. 微小项
- `src/composables/domain/useSyncMapping.ts:153`：1 处 `/* eslint-disable no-redeclare */` 抑制注释。建议用正确的联合类型消除，而非抑制。
- 测试基准 `src/__tests__/search.test.ts:274` 的 `console.log`：可保留为调试开关或降级到 `if (process.env.BENCH) `。

## 三、修复优先级建议
1. **A 类巨型模块**：优先拆 `stores/data.ts`（影响面最大、回归风险最高），其余按迭代节奏逐步推进。
2. **C 类外部硬编码**：把 favicon/canonical/探活 URL 收口到 `config/constants.ts`，并给 favicon 加本地降级——成本低、收益高（隐私 + 可用性）。
3. **B 类 `any`**：在改 A/C 时顺手把 Supabase 远端行映射改成 zod 推导类型。
4. **D/E 类**：可放在低优先 backlog，按需处理。

## 四、已清理项（2026-09-05 会话）

- **A 类收尾：`stores/data.ts` 上帝 Store 拆分**（1151 行 → 组合器 55 行 + 7 个领域文件，store id 与对外 API 100% 不变）：
  - `dataShared.ts` — 模块级机械（`_denyWrite`/`_mergeShadow`/`_maybeLoadLocalSpace`/历史防抖 Map/`DataState`+state 工厂/`DGM_KEY`）
  - `dataGetters.ts` — 全部 getters
  - `dataActionsCore.ts` — 索引维护/脏标记/搜索版本/本地历史/回收站底层
  - `dataActionsBookmarks.ts` / `Groups` / `Categories` / `Attributes` — 实体 CRUD（跨实体级联经 `this` 直达全 store）
  - `dataActionsIO.ts` — 加载/导入/空间切换
  - `data.ts` 保留为组合入口（既有 `stores/data.js` 导入路径零改动）；`DataStoreThis` 形状接口 + data.ts 末尾 extends 护栏断言防漂移
  - 验证：typecheck ✅ / lint 0 warning ✅ / vitest 265 文 4182 测全绿 ✅ / build ✅
- **B 类 `any` 清零（源码 13 处 → 1 处）**：`useSyncRealtime` HANDLERS 逐实体入参 + 唯一 cast 收口到 `h.upsert` 调用点；`syncPull` 泛型加 `Record<string, unknown>` 约束去掉 `as any`；`syncRemotePort` 动态表名 `as any` 实验证实冗余直接删除；`useMention` 换 `Editor`（@tiptap/core）+ `MentionItem` 改精确联合（顺带修复 showNear 元素类型不随 isGroup 收窄的类型洞）。唯一保留：`lib/supabase.ts` null-client mock（形状变换代理，非 any 无以表达，已注释说明）。
- **CODE_CRITIQUE P1/P3**：biometric 环境判断逐字重复 → `src/lib/secureContext.ts` `isBiometricCapableContext()` 单源；3 处「替代 bridge.ts」遗留注释改为当前职责描述。
- **AGENTS.md 过时描述**：「types.ts 与 schemas.ts 两者需保持同步」→ 修正为「schemas.ts 单一真相源，types.ts 经 z.infer 推导」。
- **测试基建抖动修复**（stash 基线对照实验证明全部为存量问题，与上述改动无关）：
  - `vitest.config.ts` 全局 `testTimeout: 30000`——真实 PBKDF2（600K 迭代）× 多次派生的 4s 级用例（useVault resetVaultWithRecoveryKey / forkPublicGroup）在低核高负载下偶发超 5s 默认超时；
  - `TrashPanel-branches.test.ts` 残留抖动**真因**：`seedTrash` 中 b1/b2 软删时间戳同毫秒时 `trashedBookmarks` 降序 sort 稳定序为 [b1,b2]，跨毫秒翻转为 [b2,b1] → 「第 0 行 = b1」点击假设随机落空（删的是 b2，b1 残留）。seed 后显式钉死 b1/b2 时间戳消除毫秒边界竞态；另加 `vi.waitFor` 双保险。
- **杂物**：会话调试产物 `outputs/`（截图 + smoke 脚本）加入 `.gitignore`。

## 五、登记在案、有意保留（非遗漏）

- `share-html`（Deno 旧兜底）与 `share-render`（CF 真源）物理双份：行为已由测试断言收敛，待 CF 端完全接管后退役。
- `data_history` 无法上 pg_cron（托管实例未启用）：触发式保留 + 注释。
- `auto-opt/*` 机器提交 173 条（历史 16%）：新提交已全部人工语义化，历史包袱不再增长。
- `docs/*.md`（含本清单）被 `.gitignore` 的 `*.md` 规则挡在版本管理外，仅 sync-e2e-governance.md 白名单入库。

## 六、已清理项（2026-08-17 会话）
- 删除空占位目录 `src/components/share/`，并在 `AGENTS.md` 补了分享功能真实实现位置说明。
- **A 类巨型模块纯函数抽取（行为零改动，对外 API 经 re-export 保持 100% 稳定）**：
  - `stores/data.ts`（1086→ 已拆出 `src/lib/dataQuery.ts`，上一会话完成）
  - `useBookmark.ts` → 去重/规范化抽至 `src/lib/bookmarkDedup.ts`（`isUrlSuffixVariant`/`isExactDuplicate`/`findDuplicateBookmarks`）
  - `useE2E.ts` → 加密字段集抽至 `src/lib/e2eFields.ts`（`ENCRYPT_FIELDS`/`LEGACY_DECRYPT_FIELDS`/`E2ECanaryMismatch`）
  - `useDeadLinkChecker.ts` → 决策纯函数抽至 `src/lib/deadLinkDecision.ts`（`classifyHttpStatus`/`makeCheckResult`/`gradeLocalNetwork`/`decide` 及类型）
  - `useDataIO.ts` → 导入解析抽至 `src/lib/importParse.ts`（`detectFormat`/`parseRaindropJSON`/`parseBookmarkHTML`/`parseCSV`/`resolveCsvColumns`/`validateImportData`）
  - `useDragDrop.ts` → 置顶换序内核抽至 `src/lib/dragSwap.ts`（`_samePinStatus`/`_swapAndMarkDirty`）
  - 验证：typecheck ✅ / lint 0 warning ✅ / 全量测试 4046 ✅ / build ✅
- **C 类 / E 类 / B 类（非同步）**：上一会话完成（commit 20f09c2c）。
- **D 类**：`ShareView.vue` 错误态加「重试」按钮 + `get_public_group` RPC 加 `Promise.race` 超时（commit e4ba9a6e）；canonical 收口随 C 类处理。
