# LinkVault 双轨治理：同步协议瘦身 × Playwright 分层 E2E

> 状态：**Phase 0–3 主线已实施**（2026-07 收尾）  
> 决策：双线并行；覆盖 Phase 0–3 全里程碑  
> 约束：**不 big-bang 重写**；复用现有 export；默认 CI **无 secrets 必须绿**
>
> **实施提交（main，相对 origin）：**  
> - `e88d1402` Phase 0–1 — merge core + L0 Playwright  
> - `18f7e12b` Phase 2 — SyncRemotePort + L1 mock E2E  
> - `09bab4c2` Phase 3 — push/pull 拆分 + L2 skip 桩  
> - `65036e00` 抽出 `syncShare`，`useCloudSync` 不再依赖 supabase  
>
> **落地文件清单（要点）：**  
> - 决策 / 编排：`syncMergeCore.ts` · `syncLocalMerge.ts` · `syncPending.ts` · `syncPush.ts` · `syncPull.ts` · `syncRemotePort.ts` · `syncShare.ts` · `useCloudSync.ts`（~218 行 facade）  
> - 单测：`syncMergeCore` · `syncPushPull` · `cloudSyncMerge` 等  
> - E2E：`app` + `l0-persist` + `l0-e2e-crypto` + `l1-sync-mock` + `helpers/supabaseMock`；`l2-sync-real` 默认 `skip`（`LV_E2E_L2=1` 才跑）  
>
> 下文 **§1 问题陈述 / §3 现状锚点** 保留基线快照（实施前），便于对照；任务勾选与 §8 文件表已随实施更新。

---

## 1. 问题陈述

> 基线（实施前）症状，**非当前代码状态**。当前见文首「已实施」与 §8。

| 轨 | 症状 | 根因 |
|----|------|------|
| **A · Sync** | `useCloudSync.ts` ~902 行，补丁型不变量（H3/RE-2/RE-12/H2/回声/死信）堆积 | 本地优先 × 队列 × Realtime × 软删 × 字段级加密锁定 = 分布式协议；pull 与 Realtime **双份规则** |
| **B · E2E** | 仅 `e2e/app.spec.ts` 冒烟；Auth/云同步 `test.skip`；src 无 `data-testid` | 厚协议的竞态窗口只在 unit 切片可见，集成路径不可证明 |

两者互相放大：协议厚 → 不敢改 → 只加分支；无集成 E2E → 不敢重构 → 继续膨胀。

---

## 2. 推荐路径（唯一主线）

**不重写、不换 CRDT/后端、不抽「大同步服务」。**

| 轨 | 目标 | 手段 |
|----|------|------|
| **A** | 降低认知负载与回归面 | Phase1 抽出 **decision 核心** → Realtime 复用 → Phase2 **IO port** → Phase3 按指标再拆 |
| **B** | 在已有 CI e2e job 上扩覆盖且不 flaky | L0 无后端 → L1 `page.route` mock → L2 可选真后端（默认不进 PR CI） |

### 硬约束

- 复用：`_mergeIntoLocal`、`_deleteWithoutEcho`、`_opNeedsUnlock`、`_isPendingSync`、`__testPendingSync`、storage `SyncOp` / `enqueueSyncOps` / `drainSyncOps` / `removeSyncOps` / `updateSyncOpRetry`
- `setGroupPublic` / `fetchPublicGroup` 可暂留 `useCloudSync` 末尾
- Realtime 不得长期与 pull 双份 conflict/soft-delete/pending 规则
- CI 已跑 chromium + `workers:1` + 重试 2；新增用例默认无 secrets 绿
- 不强制 Phase 0–1 把 `_pendingSyncIds` / `_gen` 迁进 Pinia

### 全程非目标

1. 重写 queue / 换 CRDT / 换存储  
2. 把 merge 做成与 store 完全无关的「理论纯函数」（side-effect 是产品语义；目标是 **可注入的 decision**）  
3. 默认 CI 跑真 OTP / 真 Supabase  
4. 多浏览器 / 提高 workers 并行  
5. 未证明需要前引入 MSW 全家桶  
6. 改 RLS / DB schema  
7. Phase 0–1 强行迁模块级协议状态进 Pinia  

---

## 3. 现状锚点

> **基线快照（Phase 0 前）**。实施后对照：`useCloudSync` ~218 行 facade；merge 经 `syncMergeCore`；IO 经 `syncRemotePort`；push/pull/share 已拆；L0/L1 进默认 CI，L2 默认 skip。见文首提交与文件清单。

| 项 | 路径 / 事实 |
|----|-------------|
| 编排 | `src/composables/domain/useCloudSync.ts` ~902 |
| 已拆 | `useSyncMapping` ~287 · `useSyncRealtime` ~298 · `useSyncHistory` ~163 · `useSyncConflict` ~38 · `stores/sync.ts` ~93 |
| 关键导出 | `_mergeIntoLocal` · `_deleteWithoutEcho` · `_isPendingSync` · `__testPendingSync` · `_opNeedsUnlock` |
| Realtime | `_handleRealtimeChange` 已 import `_deleteWithoutEcho` / `_isPendingSync`，但 upsert/conflict **未共用 decision** |
| 模块态 | `_pendingSyncIds` · `_initialized` · `_syncTimer`；Realtime `_channel` / `_gen` |
| 单测 | `cloudSyncMerge` · `syncLockPending` · `syncMapping` · `syncConflict` · `stores/sync` · `useE2E` |
| Playwright | 仅 `e2e/app.spec.ts`；2× skip；**无 data-testid** |
| CI | `.github/workflows/ci.yml` 已有独立 `e2e` job |
| 环境 | `.env.example`：`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |

### 回归锁定表（补丁不变量）

| 编号 | 不变量 | 优先锁定方式 |
|------|--------|--------------|
| H3 | drain 后 pending 窗口内远端 newer → conflict，勿静默 assign | unit decision + `__testPendingSync` |
| RE-2 | E2E 锁定：敏感字段 op 静默留队；非敏感可推；按 **item key** 判 | `syncLockPending` + `_opNeedsUnlock` |
| 回声 | 远端删除走 `_deleteWithoutEcho`，衍生 dirty 不回推 | `cloudSyncMerge` |
| per-op | 成功 remove、失败 retry、达上限死信并 clear pending | Phase2 fake port |
| RE-12 | initialSync 禁止盲全量复活对端软删 | Phase2 port / 后续 |
| H2 | online/visibility 时 Realtime 可自恢复 | 可选 L1；勿 flaky 强依赖 WS |
| G1 | dirty/pending 不因远端 DELETE 静默抹掉 | unit + decision |

---

## 4. 分层 E2E 定义

| 层 | 依赖 | 进默认 CI | 覆盖目标 |
|----|------|-----------|----------|
| **L0** | 无后端；localStorage/IDB | ✅ | 持久化、加密真路径 UI、现有 smoke |
| **L1** | `page.route` mock Supabase REST；假 session | ✅ | 同步 happy path、冲突条 UI |
| **L2** | 真项目 + secrets | ❌（dispatch/manual） | 跨上下文 pull；OTP 可降级为 checklist |

---

## 5. Phase 0 — 地基（0.5–1 人日）

**两轨共享，必须先完成。**

### 任务

1. **本文档入库**（即本文件）  
2. **`data-testid` 约定** `lv-<area>-<control>`，只加属性不改交互，旧 id/class 保留：

| testid | 控件 |
|--------|------|
| `lv-card-grid` | 卡片网格 |
| `lv-btn-settings` | 设置按钮 |
| `lv-search-input` | 搜索 |
| `lv-settings-drawer` | 设置抽屉 |
| `lv-e2e-status` | E2E 状态文案 |
| `lv-e2e-unlock-btn` | 设置内解锁 |
| `lv-e2e-unlock-password` | 解锁主密码输入 |
| `lv-conflict-banner` | 冲突横幅 |
| `lv-bm-modal` / `lv-bm-title` / `lv-bm-url` / `lv-bm-save` | 书签模态 |
| `lv-sync-label` | 同步状态文案 |

3. **硬化** `e2e/app.spec.ts`：优先 `getByTestId`；禁止 `.catch` silent pass（环境限制用 `test.skip` + 注释）

### 关键文件

- `docs/sync-e2e-governance.md`（本文件）  
- `e2e/app.spec.ts`  
- `AppHeader.vue` · `CardGrid.vue` · `SettingsPanel.vue` · `SyncConflictBanner.vue` · `E2EUnlockModal.vue` · `E2ESetupModal.vue` · `BookmarkModal.vue` · `FilterBar.vue`  

### 验收

- [x] testid 覆盖上表  
- [x] `npm run test:e2e` 无 secrets 全绿  
- [x] 无业务行为变更  

---

## 6. Phase 1 — merge 核心 + L0（2.5–4 人日，A/B 可并行）

### Track A：`decideRemoteApply` + Realtime 复用

**新建** `src/composables/domain/syncMergeCore.ts`：

```text
decideRemoteApply({
  localItem | null,
  remoteItem,
  isDirty, isPending,
  lastSyncAt,
  full?,
}) ->
  insert | skip | conflict | soft-delete | revive-assign | assign | full-absent-delete
```

- `_mergeIntoLocal` 变薄：循环 remote → decision → 执行 store 副作用  
- `_handleRealtimeChange`：DELETE 仍守卫 + `_deleteWithoutEcho`；UPSERT 走 **同一 decision**  
- **禁止** 把 decrypt / supabase / editor silentSet 塞进 core  
- 现有测试 import 路径：core 抽出后从 `useCloudSync` **re-export** 保持兼容  

**表驱动矩阵（≥12）** — 新建 `syncMergeCore.test.ts` 或扩展 `cloudSyncMerge.test.ts`：

| # | 场景 | 期望 |
|---|------|------|
| 1 | 本地无 + 远端活 | insert |
| 2 | 本地无 + 远端软删 | insert（回收站） |
| 3 | dirty + remoteNewer + lastSyncAt>0 | conflict |
| 4 | dirty + remote 更旧 | skip |
| 5 | pending + remoteNewer | conflict（H3） |
| 6 | 远端软删本地活 | soft-delete |
| 7 | 远端复活 | revive-assign |
| 8 | remoteNewer 普通 | assign |
| 9 | full + 远端无 + 非 dirty + lastSyncAt>0 | full-absent-delete |
| 10 | full + dirty | 不删 |
| 11 | full + pending | 不删 |
| 12 | lastSyncAt=0 | 不登记 conflict |

**A 验收**

- [x] core 无 `supabase` import  
- [x] 现有 `cloudSyncMerge` 等全绿  
- [x] Realtime conflict 条件与 merge 共用函数  
- [x] `npm run test` + `typecheck` 绿  
- [x] 整文件行数软目标 <~850（Phase3 后 facade ~218）  

### Track B：L0 Playwright

**新建**

- `e2e/l0-persist.spec.ts`：唯一 title 加书签 → reload 仍在  
- `e2e/l0-e2e-crypto.spec.ts`：设置主密码 → 锁/刷新 → 真实解锁模态（**禁止**仅 fake canary 冒充加密成功；现有 canary 用例改名标明 fake UI 门闩）  

**B 验收**

- [x] 进入默认 `npm run test:e2e`  
- [x] CI 无 secrets 绿  
- [x] 真 crypto 至少 1 条；若阻塞则 **显式 skip + 原因**，禁止 silent  

---

## 7. Phase 2 — IO port + L1 mock（3–5 人日）

### Track A：`syncRemotePort.ts`

```ts
interface SyncRemotePort {
  upsert(table, row): Promise<{ error: ... | null }>
  update(table, id, userId, patch): Promise<...>
  delete(table, id, userId): Promise<...>
  selectSince(table, userId, since): Promise<...>
  selectSoftDeleted(...): Promise<...>
  selectAllIds(table, userId): Promise<...>
}
createSupabaseSyncPort(): SyncRemotePort
```

- `_pushFromQueue` / `_pullChanges` / `initialSync` id probe 走 port  
- **不** 重写 per-op / RE-2 lockedItemKeys / reconcile abort  
- 分享 RPC 可暂留直接 supabase  
- 新测 `syncPushPull.test.ts`：per-op 成败、死信 clear pending、锁定不 upsert、pull 解密中 lock 不推进 lastSyncAt、selectAllIds error 不软删  

**A 验收**

- [x] 同步路径 `supabase.from` 归零（分享 `setGroupPublic` / `fetchPublicGroup` 除外）  
- [x] fake port ≥6 场景（`syncPushPull.test.ts`，IDB 内存 mock）  
- [x] 软目标 `useCloudSync` <750 行（Phase3 后 ~218）  

### Track B：L1

**新建** `e2e/l1-sync-mock.spec.ts` + `e2e/helpers/supabaseMock.ts`

1. route `auth/v1/*` + init 假 session（对齐 `useAuth` 启动路径）  
2. Happy path：手动同步优先（避 debounce 3s flaky）→ 非「同步失败」  
3. Conflict：优先 mock 更高 `updated_at_num`；兜底 `addConflict` 只测 banner UI（至少 1 条 testid + 按钮）  
4. **不强制** mock Realtime WebSocket  

**B 验收**

- [x] CI 无 secrets：`playwright.config` 注入 mock `VITE_SUPABASE_*` + `page.route`  
- [x] happy + conflict 各 ≥1  
- [x] 本地自检：门禁全绿（lint/typecheck/unit/e2e）；连续 5 次 flaky 抽检可后续补  

---

## 8. Phase 3 — 可选 L2 + 按需再拆（2–4 人日）

### Track A

Phase2 后 `useCloudSync.ts` 仍 ~914 行 → **已拆**：

| 模块 | 内容 |
|------|------|
| `syncPush.ts` | `pushFromQueue` · `_mergeOps` · `_opNeedsUnlock` · `enqueueDirtyAsOps` |
| `syncPull.ts` | `pullChanges` · 解密 · soft-delete · reconcile |
| `syncLocalMerge.ts` | `_mergeIntoLocal` · `_deleteWithoutEcho` |
| `syncPending.ts` | `_pendingSyncIds` / H3 |
| `useCloudSync.ts` | debounced/full/initial + 生命周期（~218 行） |
| `syncShare.ts` | `setGroupPublic` / `fetchPublicGroup`；`useDataShare` 直接引用 |

### Track B

- [x] `e2e/l2-sync-real.spec.ts`：`test.skip(!process.env.LV_E2E_L2)`  
- 可选 `.github/workflows/e2e-l2.yml` + secrets（未做）  
- OTP 成本过高 → 降级 **手动 checklist**，不阻塞主线  

---

## 9. 依赖与并行

```text
Phase 0 (docs + testid + smoke)
    ├─► P1-A merge core  ║  P1-B L0 E2E
    ├─► P2-A IO port     ║  P2-B L1 mock
    └─► P3-A 按需再拆    ║  P3-B L2 optional
```

L1 **不依赖** port（可并行）；port 利于单测推演。

---

## 10. 验证命令

```bash
npm run test
npx vitest run src/__tests__/composables/cloudSyncMerge.test.ts
npx vitest run src/__tests__/composables/syncLockPending.test.ts
npx vitest run src/__tests__/composables/syncMapping.test.ts
npx vitest run src/__tests__/composables/syncConflict.test.ts
npx vitest run src/__tests__/stores/sync.test.ts
# Phase 1+ / 2+
npx vitest run src/__tests__/composables/syncMergeCore.test.ts
npx vitest run src/__tests__/composables/syncPushPull.test.ts

npm run typecheck
npm run lint

npm run test:e2e
npx playwright test e2e/l0-persist.spec.ts
npx playwright test e2e/l1-sync-mock.spec.ts

# L2 仅显式
LV_E2E_L2=1 npx playwright test e2e/l2-sync-real.spec.ts
```

---

## 11. 成功指标（Phase 2 末）

| 指标 | 基线 | 目标 |
|------|------|------|
| `useCloudSync` 职责 | 编排+merge+IO+share 混杂 | decision 独立；IO 经 port |
| merge 测试 | 场景式 | 表驱动 ≥12 + 副作用契约 |
| Realtime vs pull | 双份规则 | conflict/soft-delete/pending 同一 decision |
| Playwright | 1 文件 smoke + skip | L0 持久化+可证 crypto；L1 sync+conflict |
| CI e2e | 已有 | 仍无 secrets、workers=1、非 flaky |
| 补丁表 | 注释考古 | 每条有单测或 E2E 引用 |

---

## 12. 关键文件总表

| 阶段 | 路径 |
|------|------|
| 0 | `docs/sync-e2e-governance.md` · 上列 Vue · `e2e/app.spec.ts` |
| 1 | **新** `syncMergeCore.ts` · `useCloudSync.ts` · `useSyncRealtime.ts` · `syncMergeCore.test.ts` · `e2e/l0-*.spec.ts` |
| 2 | **新** `syncRemotePort.ts` · `syncPushPull.test.ts` · `e2e/l1-sync-mock.spec.ts` · `e2e/helpers/supabaseMock.ts` |
| 3 | **已** `syncPush.ts` / `syncPull.ts` / `syncLocalMerge.ts` / `syncPending.ts` / `syncShare.ts` · `e2e/l2-sync-real.spec.ts`（默认 skip）· 可选 `e2e-l2.yml`（未做） |
| 辅 | `stores/storage.ts` · `stores/sync.ts` · `SyncConflictBanner.vue` · `ci.yml`（默认不改） |

---

## 13. 建议开工顺序（本周）

> Phase 0–3 主线已完成。下文为历史开工顺序，保留备查。

1. Phase 0 testid + smoke（0.5d）  
2. 并行：`syncMergeCore` 表驱动 与 `l0-persist`  
3. Realtime 接 decision  
4. `l0-e2e-crypto`  
5. 再开 Phase 2 port / L1  

总预估 Phase 0–2：**约 6–10 人日**；Phase 3 按需。

### 后续可选（非主线阻塞）

- 扩展 `e2e/l2-sync-real.spec.ts` 真会话路径（需 `LV_E2E_L2=1` + secrets）  
- 可选 `e2e-l2.yml` workflow  
- OTP 手动 checklist  
- L1 连续 5 次 flaky 抽检记录
