# 与链（ulink）技术债清单

> 扫描于 2026-08-17，基于 `src/` 源码静态分析。
> **2026-10-31 追加**：新增 §零（文档核对 + 线上状态发现），并修正正文中已失效的数字/结论；历史表格保留「当时快照」语义，引用前先看行内注记。
> 重要澄清：此前统计的「106 处 TODO」为**误报**——正则把恢复密钥占位符 `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` 里的 `XXX` 当成了 HACK 标记，加上测试文件里的同类占位符。源码内**没有任何真实的 TODO/FIXME/HACK 注释**。

## 零、2026-10-31 新增（文档核对 + 线上状态，按优先级）

| # | 级别 | 问题 | 处理结果（2026-10-31） |
|---|---|---|---|
| 1 | **P0** | **生产安全响应头**：`ulink.ren` 无 CSP / X-Content-Type-Options / Referrer-Policy / Permissions-Policy（CloudBase 静态托管不支持自定义响应头，`public/_headers` 只对 CF Pages 生效） | **部分修复**：新增 `securityMetaPlugin`，构建期把 CSP（无 frame-ancestors）+ Referrer-Policy 以 `<meta>` 注入两个 HTML 入口（`dist/index.html` / `dist/app.html` 已验证），`check:prod` 增加安全探测（缺失退出码 4）。**残留**：X-Content-Type-Options 与 frame-ancestors 无 meta 等价物，仍需平台侧支持（工单/反代） |
| 2 | **P0** | **`pay` 云函数 `Update failed`** | ✅ **已修复**：2026-10-31 `node scripts/deploy-cloudbase-fn.mjs pay` 重新部署，`fn detail` 状态 `Active`、ModTime `21:31`；路由 `/pay` 仍为 WEB_SCF |
| 3 | **P1** | **视频深度额度迁移未应用**（`plans.features.video.deep.daily` 为 null） | ✅ **已修复**：2026-10-31 应用 `20261030000001_video_deep_quota.sql`；现 free=0、PRO 各档=2（`test_1fen` 为测试档，未改）。`20261031000001`（退额度）此前已应用 |
| 4 | **P1** | **文档状态与现网相反** | ✅ 2026-10-31 已批量修正：根文档 + 计费/支付/AI/品牌/视频/分享/备案/supabase README 等 20+ 篇；同步给 `pay` 文档补 transactions 说明 |
| 5 | **P1** | **法律文本与产品能力/实现不一致** | **已修订待法务复核**：隐私政策（支付已接入、AI 名单改邮箱索取、补 Cloudflare 边缘/扩展读取/自动读页/公开图片桶披露、更新日期）；协议（服务内容补视频解析、统一 AI 表述、配额举例按实际、日期）；退款政策（删除不存在的"自动续费"整节、补季付、退款降级改"人工执行"）；PENDING 状态同步。**仍待**：AI 服务商入口恢复、退款自动降级系统联动 |
| 6 | **P1** | **订阅过期后 AI 额度不回落** | ✅ **已修复**：新增并应用 `20261031000002_ai_quota_expiry.sql`，`ai_quota_check` 在 `expired` / `refunded` 时改用 `plans.free` 的 `ai.tokens.monthly`（已查 `pg_get_functiondef` 确认分支存在） |
| 7 | **P1** | **plans 中写入了未强制执行的额度** | ⏳ **未修**（属产品决策）：`storage.bytes` / `sync.devices` / `history.days` / `linkcheck.daily` / `ai.requests.daily` 仍无门控实现。已在 `PRICING.md` 标注「目前真正强制的只有 AI token / 视频解析 / 深度解析 / 自动巡检」 |
| 8 | **P2** | **`pay` 的 `transactions`/`orders` action 永远 400** | ✅ **已修复**：白名单改为 `Set(create,status,plans,transactions,orders)`；重部署后实测 `POST /pay {action:'transactions'}` 返回 `401 unauthorized`（不再 400 unknown_action） |
| 9 | **P2** | **CLI 仍以 Supabase 为目标** | ⏳ **未适配**：已在 `cli/README.md` 顶部标注「参考实现，勿操作生产」，README 已入库（`.gitignore` 白名单） |
| 10 | **P2** | **AI 服务商名单入口与联系方式缺失** | ⏳ **未恢复 UI**：法律文本已改为邮箱索取兜底；`aiProviders.ts` 仍缺联系方式字段，恢复「设置 → 关于 → AI 服务商」入列为后续待办（PIPL 23 条） |
| 11 | **P3** | **文档缺索引与状态机制** | ⏳ 未做：建议新建 `docs/README.md`（状态/最后核实/负责范围） |

## 一、先排除的误报（非技术债）

| 项目 | 真实情况 |
|------|----------|
| 源码 TODO/FIXME/HACK | **0 处**（仅 `ai-classify.ts` 关键词列表含 "todo" 字面；非待办） |
| 源码 `@ts-nocheck`/`@ts-expect-error` | **0 处**；`@ts-ignore` 现有 **1 处**（`src/lib/errorReporter.ts`，为 `supabase.functions.invoke` 的 `signal` 字段，历史遗留） |
| 源码 `console.log`/`debugger` | **0 处**（`search.test.ts` 的基准日志已改为 `if (process.env.BENCH)` 门控，属测试） |
| 违反「禁止 var」规范 | **0 处** |
| 测试内 `any`、`@ts-*` | 测试桩代码，不影响产品类型安全，**不算产品债**（原「1577 处」为 2026-08 快照，未重扫） |

## 二、真正的技术债（按优先级）

### A. 可维护性：巨型模块

> 下表行号为 **2026-08-17 快照**。`stores/data.ts` 已于 2026-09-05 拆为 46 行组合入口 + 7 个领域文件（见 §四）；其余文件行数也已变化（如 `useBookmark` 863、`useDeadLinkChecker` 878、`useDragDrop` 744、`useE2E` 793、`useDataIO` 514），需要时以当前文件为准重扫。

| 文件 | 行数（08-17） | 职责 | 建议拆分方向 |
|------|------|------|--------------|
| `src/stores/data.ts` | 1086 → **已拆（46 行）** | 书签/组/分类/属性 CRUD + 过滤 + 排序 | ✅ 已按实体拆为 `dataActions*.ts` |
| `src/composables/domain/useE2E.ts` | 825 | E2E 加密/解密/迁移 | 加解密纯函数 vs 状态编排分离 |
| `src/composables/domain/useDeadLinkChecker.ts` | 724 | 死链检测（批量/节流/网络） | 网络探活、批量调度、结果处理分层 |
| `src/composables/domain/useDataIO.ts` | 653 | 导入/导出 | 格式解析 vs 持久化写入分离 |
| `src/composables/domain/useBookmark.ts` | 639 | 书签业务逻辑 | 去重/规范化/图标派生可抽纯函数 |
| `src/composables/interaction/useDragDrop.ts` | 588 | 拖拽排序 | 通用 DnD 内核 vs 业务绑定分离 |

### B. 类型安全缺口：源码 `any`

> 2026-09-05 曾把源码 any 收到 1 处；2026-10-31 复核 **又引入若干**（sync/share/图片存储等），原「13→1」结论不再成立。

现存（2026-10-31，≥10 处）：`stores/share.ts`（5）、`lib/imageStorage.ts`（3）、`stores/dataGetters.ts`（1）、`composables/useCombinedList.ts`（1）、`views/buildShareEntries.ts`（1）、`lib/supabase.ts`（1，历史 mock）。
建议：优先处理 share 与 imageStorage（外部行映射可换 `z.infer` 类型）。

### C. 外部服务硬编码 / 魔法字符串（**已解决**）

> 2026-10-31 注：下列各项均已收口到 `src/config/urls.ts`（`FAVICON_PROVIDER_URL` / `NETWORK_PROBE_URLS` / `APP_CANONICAL_BASE` / `CF_FN_BASE`），`constants.ts` 不是正确路径（刻意避免与 `welcome-data` 循环依赖）。下表保留为 8-17 快照。

| 位置 | 原硬编码内容 | 风险 | 现状 |
|------|-----------|------|------|
| `src/utils.ts:68`、`welcome-data.ts` | `https://api.xinac.net/icon/?url=` 第三方 favicon | 单点故障 + 隐私 | ✅ 已收口 `config/urls.ts` |
| `useBookmark.ts` | `google.com/s2/favicons` | 区域可用性 | ✅ 已改 `favicon()` |
| `useDeadLinkChecker.ts` | 写死探活 URL | 换环境失效 | ✅ `NETWORK_PROBE_URLS` |
| `src/views/ShareView.vue` | canonical 写死旧域名 | 换域名麻烦 | ✅ `APP_CANONICAL_BASE`（该组件已删除，常量仍在用） |

### D. ShareView.vue 观察（**已失效**）

`ShareView.vue` 已于 2026-08-31（`6c72f61b`）删除，分享页改为主应用只读态；该节 3 条观察不再适用，保留仅作历史记录。

### E. 微小项（**已解决**）

- `useSyncMapping.ts` 的 `eslint-disable no-redeclare` 已移除。
- `search.test.ts` 的 `console.log` 已加 `if (process.env.BENCH)` 门控。

## 三、修复优先级建议

1. **§零 P0**：生产安全响应头、`pay` 云函数 UpdateFailed —— 影响面最大且外部可见。
2. **§零 P1**：视频深度迁移、订阅过期 AI 额度、未强制额度、法律文本一致性（法务）。
3. **文档状态**：按本次审计逐篇补「最后核实/当前状态」，或直接改数字（BILLING_*、PAYMENT_INTEGRATION、ALIPAY/WXPAY、PRICING、CLOUDBASE_MIGRATION、AI_BACKEND_SPLIT、CODE_CRITIQUE、supabase 两篇 README）。
4. **B 类 `any`**：改 A/C 时顺手把远端行映射改成 zod 推导类型。
5. **D/E 类**：已失效/已解决，无需处理。

## 四、已清理项（2026-09-05 会话）

- **A 类收尾：`stores/data.ts` 上帝 Store 拆分**（1151 行 → 组合器 46 行 + 7 个领域文件，store id 与对外 API 100% 不变）：
  - `dataShared.ts` — 模块级机械（`_denyWrite`/`_mergeShadow`/`_maybeLoadLocalSpace`/历史防抖 Map/`DataState`+state 工厂/`DGM_KEY`）
  - `dataGetters.ts` — 全部 getters
  - `dataActionsCore.ts` — 索引维护/脏标记/搜索版本/本地历史/回收站底层
  - `dataActionsBookmarks.ts` / `Groups` / `Categories` / `Attributes` — 实体 CRUD（跨实体级联经 `this` 直达全 store）
  - `dataActionsIO.ts` — 加载/导入/空间切换
  - `data.ts` 保留为组合入口（既有 `stores/data.js` 导入路径零改动）；`DataStoreThis` 形状接口 + data.ts 末尾 extends 护栏断言防漂移
  - 验证：typecheck ✅ / lint 0 warning ✅ / vitest 全绿 ✅ / build ✅
- **B 类 `any` 清零（源码 13 处 → 1 处）**：`useSyncRealtime` HANDLERS 逐实体入参 + 唯一 cast 收口到 `h.upsert` 调用点；`syncPull` 泛型加 `Record<string, unknown>` 约束去掉 `as any`；`syncRemotePort` 动态表名 `as any` 实验证实冗余直接删除；`useMention` 换 `Editor`（@tiptap/core）+ `MentionItem` 改精确联合（顺带修复 showNear 元素类型不随 isGroup 收窄的类型洞）。唯一保留：`lib/supabase.ts` null-client mock（形状变换代理，非 any 无以表达，已注释说明）。*（2026-10-31：新代码又引入若干 any，见 §二 B）*
- **CODE_CRITIQUE P1/P3**：biometric 环境判断逐字重复 → `src/lib/secureContext.ts` `isBiometricCapableContext()` 单源；3 处「替代 bridge.ts」遗留注释改为当前职责描述。
- **AGENTS.md 过时描述**：「types.ts 与 schemas.ts 两者需保持同步」→ 修正为「schemas.ts 单一真相源，types.ts 经 z.infer 推导」。
- **测试基建抖动修复**（stash 基线对照实验证明全部为存量问题，与上述改动无关）：
  - `vitest.config.ts` 全局 `testTimeout: 30000`——真实 PBKDF2（600K 迭代）× 多次派生的 4s 级用例（useVault resetVaultWithRecoveryKey / forkPublicGroup）在低核高负载下偶发超 5s 默认超时；
  - `TrashPanel-branches.test.ts` 残留抖动**真因**：`seedTrash` 中 b1/b2 软删时间戳同毫秒时 `trashedBookmarks` 降序 sort 稳定序为 [b1,b2]，跨毫秒翻转为 [b2,b1] → 「第 0 行 = b1」点击假设随机落空（删的是 b2，b1 残留）。seed 后显式钉死 b1/b2 时间戳消除毫秒边界竞态；另加 `vi.waitFor` 双保险。
- **杂物**：会话调试产物 `outputs/`（截图 + smoke 脚本）加入 `.gitignore`。

## 五、登记在案、有意保留（非遗漏）

- **share-render 三份副本**：`functions/_lib/share-render.ts`（真源）→ `cloudbase/functions/share-ssr/share-render.js`（`build-fn-assets` 派生，生产在用）→ Deno 旧兜底 `supabase/functions/share-html/index.ts`（仅旧链接）。CF Pages 版已非生产路径，待退役。
- `data_history` 无法上 pg_cron（托管实例未启用）：触发式保留 + 注释。
- `auto-opt/*` 机器提交 169 条（总提交 1462，约 11.6%）：新提交已全部人工语义化，历史包袱不再增长。
- ~~`docs/*.md` 被 `.gitignore` 挡在版本管理外~~：**已不成立**——`.gitignore` 现有 `!docs/**/*.md`，23 篇 docs 全部入库（2026-10-25 `8afa63d5` 起）。`cli/README.md` 仍未入库，建议补白名单。

## 六、已清理项（2026-08-17 会话）

- 删除空占位目录 `src/components/share/`，并在 `AGENTS.md` 补了分享功能真实实现位置说明。
- **A 类巨型模块纯函数抽取（行为零改动，对外 API 经 re-export 保持 100% 稳定）**：
  - `stores/data.ts`（1086→ 已拆出 `src/lib/dataQuery.ts`，上一会话完成）
  - `useBookmark.ts` → 去重/规范化抽至 `src/lib/bookmarkDedup.ts`（`isUrlSuffixVariant`/`isExactDuplicate`/`findDuplicateBookmarks`）
  - `useE2E.ts` → 加密字段集抽至 `src/lib/e2eFields.ts`（`ENCRYPT_FIELDS`/`LEGACY_DECRYPT_FIELDS`/`E2ECanaryMismatch`）
  - `useDeadLinkChecker.ts` → 决策纯函数抽至 `src/lib/deadLinkDecision.ts`（`classifyHttpStatus`/`makeCheckResult`/`gradeLocalNetwork`/`decide` 及类型）
  - `useDataIO.ts` → 导入解析抽至 `src/lib/importParse.ts`（`detectFormat`/`parseRaindropJSON`/`parseBookmarkHTML`/`parseCSV`/`resolveCsvColumns`/`validateImportData`）
  - `useDragDrop.ts` → 置顶换序内核抽至 `src/lib/dragSwap.ts`（`_samePinStatus`/`_swapAndMarkDirty`）
  - 验证：typecheck ✅ / lint 0 warning ✅ / 全量测试全绿 ✅ / build ✅
- **C 类 / E 类 / B 类（非同步）**：上一会话完成（commit 20f09c2c）。
- **D 类**：`ShareView.vue` 错误态加「重试」按钮 + `get_public_group` RPC 加 `Promise.race` 超时（commit e4ba9a6e）；该组件后已于 `6c72f61b` 删除。
