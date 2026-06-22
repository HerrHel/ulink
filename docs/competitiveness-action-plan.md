# LinkVault 竞争力提升 — 最终决策总结

> **主导依据**：A/B 工程师攻防会议  
> **补充参考**：`meeting-competitiveness-analysis.md` 中的离线队列、智能排序、生物识别等增量建议

---

## 一、产品现状诊断

| 维度 | 现状 | 评分 |
|------|------|------|
| 数据层 | Pinia 三 Store 拆分，LocalStorage + IndexedDB 双持久化，Supabase 增量云同步，软删除 + 回收站 + 版本历史 | ✅ 扎实 |
| 功能层 | 书签 CRUD、分类、属性标签、TipTap 富文本组编辑器、@Mention 内联卡片、子书签嵌套、拖拽排序、批量管理、AES-GCM 密码加密 | ✅ 全面 |
| 搜索 | 纯 `toLowerCase().includes()` 暴力匹配，无模糊、无拼音、无语义 | ❌ 薄弱 |
| 分发 | 无浏览器扩展，无公开分享页，无 SEO 入口 | ❌ 几乎为零 |
| 同步 | push-first 手动同步，冲突静默覆盖（`_merge` 时间戳比较），无离线队列 | ⚠️ 有风险 |
| 迁移 | 仅支持自有 JSON 格式导入 | ❌ 壁垒高 |

**核心结论：功能完整度 70 分，分发能力 10 分。问题不在产品不够好，在于没人知道它存在。**

---

## 二、竞品弱点分析

| 竞品 | 弱点 | LinkVault 的切入点 |
|------|------|-------------------|
| **Raindrop.io** | 密码明文存储；中文搜索不支持拼音；免费版限制多；无端到端加密 | 安全加密 + 中文搜索优化 |
| **Pinboard** | 界面过时；无富文本笔记；无移动端 App | 现代 UI + 组编辑器 + PWA |
| **Notion Web Clipper** | 书签只是 Notion 的附属功能，不是核心；启动慢、重量级 | 轻量专注、速度快 |
| **浏览器原生书签** | 无跨设备同步（除非登录同一账号）；无标签、无笔记、无搜索 | 云同步 + 智能组织 |

---

## 三、产品定位调整

**旧定位**：「全能型书签与收藏管理工具」

**新定位**：**「知识工作者的链接中枢」**

**Slogan**：**「收藏即整理，链接即知识」**

**差异化三角**：

```
        安全加密（AES-GCM）
           /          \
          /            \
    智能组织 ———————— 无缝触达
  （模糊搜索+属性）   （浏览器扩展+分享）
```

---

## 四、最终优先级与行动方案

### 🔴 P0 — 生死线（第 1-2 周）

> 核心逻辑：**先让人能来、来了能找到**

#### 1. Chrome 浏览器扩展（Side Panel）

**目标**：占领浏览器侧边栏，成为用户日常触达入口

- 利用 Chrome Side Panel API，打开任意网页时可呼出 LinkVault 侧边栏
- `chrome.bookmarks` API 一键导入浏览器原生书签（零迁移成本）
- 当前页面拖拽到侧边栏 = 一键收藏
- Content Script 从页面 `<meta>` 标签提取 title/description 自动预填
- 通过 `chrome.storage.local` + 后台同步与 Web App 共享数据

**对应代码改动**：新建 `extension/` 目录，Chrome Manifest V3

#### 2. 搜索增强

**目标**：让「找回来」和「收藏」一样顺畅

**当前问题**（`data.ts` 第 74-80 行）：

```typescript
// 暴力匹配 — 搜「代码」找不到 GitHub
bm = bm.filter(b =>
  b.title.toLowerCase().includes(q) ||
  b.url.toLowerCase().includes(q) || ...
)
```

**改进方案**：

- 引入 **Fuse.js**（~25KB gzipped），支持模糊匹配 + 权重排序
- 引入 **pinyin-pro**，支持拼音搜索（搜 `github` 或 `g` 都能找到 GitHub）
- title 权重 > url 权重 > notes 权重 > username 权重

#### 3. 同步冲突提示

**当前问题**（`useCloudSync.ts` 第 310-343 行）：

```typescript
// 同一 ID 两端都有修改 → 时间戳大的赢，另一端静默丢失
} else if (getRemoteTs(rItem) > getLocalTs(lItem)) {
  result.push(rItem) // 本地修改被覆盖，无任何提示
}
```

**改进方案**：

- `_merge` 检测到同一 ID 本地 dirty 且远端时间更新时，标记为 `conflict` 而非直接覆盖
- 新增冲突列表 UI 面板，展示冲突项的本地版 vs 远端版差异
- 用户逐条选择保留哪个版本

---

### 🟡 P1 — 增长引擎（第 3-4 周）

> 核心逻辑：**降低迁移门槛 + 启动传播**

#### 4. 多格式导入向导

| 来源 | 格式 | 映射关系 |
|------|------|---------|
| Chrome/Firefox/Safari | HTML（Netscape Bookmark） | 文件夹 → category |
| Raindrop.io | JSON | collection → category，tag → customAttribute |
| 通用 CSV | CSV（title, url, tags） | tags → customAttribute |

**当前问题**：`useDataIO.ts` 的 `importData` 仅支持自有 JSON

#### 5. 公开分享链接

- `Bookmark` / `SiblingGroup` 类型新增 `is_public?: boolean` 字段
- Supabase RLS 增加公开读取策略：`is_public = true` 时允许匿名 SELECT
- 新增 `/share/:id` 路由渲染只读页面
- 每个公开组页 = 一个 SEO 入口（服务端渲染或预渲染）

**对应数据库改动**：

```sql
-- 新增公开读取策略
CREATE POLICY "Public groups are readable" ON sibling_groups
  FOR SELECT USING (is_public = true);
```

#### 6. 页面可见时自动同步

**补充自另一场会议** —— 改动极小、收益大

当前代码已有 `_onVisibilityChange`（`useCloudSync.ts` 第 457-465 行），但只在 `autoSync` 开启时工作。确认以下场景自动触发：

- 页面从后台切回前台
- 网络从离线恢复为在线
- 首次加载完成时

---

### 🟢 P2 — 体验深化（第 5-8 周）

#### 7. 本地 AI 分类建议

- 浏览器端运行 Transformers.js（~50MB 模型缓存，首次加载后本地可用）
- 用户收藏新链接时，分析 title + url + notes → 建议分类 + 建议属性标签
- 用户确认或拒绝，拒绝时不影响体验
- 同一 URL 的分析结果缓存在 `bookmark.metadata` 字段，不重复计算

#### 8. 智能排序算法

**补充自另一场会议** —— 与 AI 建议互补

在现有 `useCount` 排序基础上，引入时间衰减加权：

```
score = useCount × e^(-λ × daysSinceLastUse)
```

- λ 建议值 0.05（约 2 周半衰期）
- 作为默认排序选项「推荐」，替代当前的「自定义」默认

#### 9. PWA 离线支持

- Service Worker 缓存全部静态资源 + IndexedDB 数据
- 添加到主屏幕后全屏运行，类原生体验
- 补充离线操作队列（参考另一场会议建议）：
  - IndexedDB 新增 `pendingOps` 表
  - 所有写操作先入队列，上线后按序回放

#### 10. 生物识别解锁

**补充自另一场会议**

- WebAuthn API 解锁主密码
- 移动端指纹/面部识别，桌面端 Windows Hello / Touch ID
- 替代每次手动输入主密码的体验

---

### 🔵 P3 — 远期探索（第 9+ 周）

#### 11. 全局命令面板（Cmd+K）

- 统一搜索入口：搜索书签 + 组 + 操作命令（新建、导入、同步……）
- 类 Raycast / Notion 的体验
- `fuse.js` 搜索结果 + 命令注册系统

#### 12. 导入他人公开分享链接

- 用户 A 分享一个公开组 → 用户 B 一键 fork 到自己库
- 采用**复制**模式（不引用），避免删除传播问题
- 病毒式增长的关键机制

---

## 五、明确排除（不做清单）

| 排除项 | 原因 |
|--------|------|
| ❌ Supabase Realtime 实时同步 | 成本不可控，visibilitychange + Web Push 通知已够用 |
| ❌ Yjs 实时协作 | 包体积 +50KB，需 WebSocket 服务器，需求未验证 |
| ❌ 全功能社交平台（用户资料、关注、动态） | 与「个人效率工具」定位冲突，运营成本不可承受 |
| ❌ Notion 式全能工作区 | 专注书签管理，不做全能笔记 |
| ❌ 每次收藏调用云端 LLM | 成本不可控，用本地模型 + 简单算法替代 |

---

## 六、技术债务同步修复

在推进新功能的同时，以下代码级问题需要同步处理：

| 问题 | 位置 | 修复方案 |
|------|------|---------|
| `app.ts` 兼容层 69 行 UI key 逐个映射 | `stores/app.ts` | 新代码直接 useDataStore/useUIStore，逐步废弃 app store |
| `_merge` 泛型函数缺少 categories/attrs 的时间戳比较 | `useCloudSync.ts:345-354` | 统一传入 `updatedAt` 比较器 |
| `BookmarkModal` 9 字段重表单 | `useBookmark.ts` | 快速收藏模式：仅 URL 必填，其余可选 |
| 搜索无 debounce | `AppHeader.vue:82-86` | 已有 300ms debounce ✅ 但 getter 内过滤无缓存，大数据量需优化 |

---

## 七、里程碑总览

```
第1-2周  ──── P0：浏览器扩展 + 搜索增强 + 册突提示
                ↓ 有分发渠道、搜索可用、数据不丢
第3-4周  ──── P1：多格式导入 + 公开分享 + 自动同步
                ↓ 用户能零成本迁来、内容可传播
第5-8周  ──── P2：AI 分类 + 智能排序 + PWA + 生物识别
                ↓ 体验差异化、离线可用
第9+周   ──── P3：命令面板 + 分享导入 + 性能感知优化
                ↓ 完整产品闭环
```

---

## 八、核心共识

**先让 LinkVault 被发现（浏览器扩展），再让人找得到东西（搜索增强），再让人敢托付数据（同步可靠性），最后让人离不开（AI + PWA + 分享传播）。**

功能堆砌不是竞争力，把三件事做到极致才是：

1. **收藏这一个动作无比顺畅**（浏览器扩展 Side Panel）
2. **找回东西这件事无比智能**（模糊搜索 + 拼音 + AI 分类）
3. **数据同步这件事无比可靠**（冲突提示 + 离线队列 + 自动同步）

---

## 九、实施进度追踪

### P0-2 搜索增强 ✅ 已完成

**新增文件：**

| 文件 | 说明 |
|------|------|
| `src/lib/search.ts` | Fuse.js 模糊搜索引擎 + pinyin-pro 拼音支持 |

**修改文件：**

| 文件 | 改动 |
|------|------|
| `src/stores/data.ts` | `filteredBookmarks` / `filteredGroups` getter 接入 `searchBookmarkIds` / `searchGroupIds`，替换原 `includes()` 暴力匹配 |
| `src/components/overlays/SearchSuggest.vue` | 接入 `searchWithHighlights`，使用 Fuse.js 字符级高亮替代原正则高亮 |
| `src/components/cards/BookmarkCard.vue` | 搜索时卡片标题、域名、备注自动高亮匹配文本 |
| `src/styles/cards.css` | 新增 `.card-hl` 搜索高亮样式 |
| `package.json` | 新增 `fuse.js`、`pinyin-pro` 依赖 |

**搜索能力对比：**

| 场景 | 改动前（includes） | 改动后（Fuse.js + 拼音） |
|------|--------------------|--------------------------|
| 搜「githb」找 GitHub | ❌ 找不到 | ✅ 模糊容错匹配 |
| 搜「youjian」找邮箱 | ❌ 找不到 | ✅ 拼音匹配 |
| 搜「代码」找含中文笔记的书签 | ✅ 精确子串匹配 | ✅ 保留，同时增加模糊能力 |
| 搜「git」只匹配 GitHub | ✅ | ✅ 阈值 0.2 确保不误匹配 Google |
| 搜「engine」匹配 notes 中的词 | ✅ | ✅ Fuse.js 多字段加权搜索 |
| 搜索建议高亮 | 正则子串高亮 | Fuse.js 匹配索引字符级高亮 |

---

### P0-3 同步冲突提示 ✅ 已完成

**新增文件：**

| 文件 | 说明 |
|------|------|
| `src/components/overlays/SyncConflictBanner.vue` | 冲突通知面板，底部弹出式，支持逐条/批量解决 |

**修改文件：**

| 文件 | 改动 |
|------|------|
| `src/composables/domain/useCloudSync.ts` | `_merge` 函数增加冲突检测；新增 `conflicts` ref、`resolveConflict()`、`resolveAllConflicts()`；`resetSyncState()` 清理冲突状态 |
| `src/config/icons.ts` | 新增 `alert` 警告图标 |
| `src/App.vue` | 接入 `<SyncConflictBanner />` 组件 |

**冲突检测逻辑：**

```
触发条件（三个条件同时满足）：
  1. 本地有未推送修改（dirtyIds.has(id)）
  2. 远端时间戳比本地更新（remoteTs > localTs）
  3. 之前已经同步过一次（lastSync > 0）

用户可选操作：
  - 保留本地（keepLocal=true）→ 仅清除冲突标记
  - 用云端覆盖（keepLocal=false）→ 将远端数据写入本地并 save()
  - 全部保留本地 / 全部用云端 → 批量解决
```

---

### P0-1 浏览器扩展 ✅ 已完成

**架构决策：**

| 方案 | 采用 | 说明 |
|------|------|------|
| Side Panel 嵌入 iframe | ❌ | 跨域 + 认证复杂 |
| Side Panel + Supabase 直连 | ✅ | 独立轻量 UI，与 Web App 共享同一数据库 |
| Content Script 读 localStorage | ❌ | 旧方案，已移除 |

**新增文件：**

| 文件 | 说明 |
|------|------|
| `extension/manifest.json` | Manifest V3，权限：sidePanel + activeTab + bookmarks + storage |
| `extension/background.js` | Service Worker：点击打开 Side Panel、Chrome 书签递归遍历导入 |
| `extension/content.js` | 提取页面 `<meta description/keywords>`，供快速收藏预填 |
| `extension/sidepanel.html` | Side Panel UI：登录、当前页收藏、搜索、Chrome 书签导入 |
| `extension/sidepanel.js` | 核心逻辑：Supabase 认证（邮箱 OTP）、书签 CRUD、搜索、批量导入 |

**功能清单：**

| 功能 | 状态 | 说明 |
|------|------|------|
| 邮箱验证码登录 | ✅ | 与 Web App 共享 Supabase auth，同一账号 |
| 当前页一键收藏 | ✅ | 读取 activeTab URL + title + favicon，写入 Supabase |
| 书签搜索 | ✅ | 从 Supabase 拉取前 500 条，本地 title/url/notes 过滤 |
| Chrome 书签导入 | ✅ | `chrome.bookmarks.getTree()` 递归遍历，去重后批量 upsert |
| 书签列表浏览 | ✅ | 按使用频率排序，点击在新标签页打开 |
| 状态栏 | ✅ | 连接状态 + 书签总数 |

**与 Web App 数据同步机制：**

```
扩展 Side Panel ──→ Supabase（同一 RLS 策略）←── Web App
         ↕                                        ↕
   chrome.storage（会话）                   localStorage + IndexedDB
```

两个客户端共享同一个 Supabase 数据库和 RLS 策略，天然实时一致。

**安装方式（开发阶段）：**

1. Chrome 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展」
4. 选择 `extension/` 目录

---

### 测试结果

```
12 test files  → 12 passed
171 test cases → 171 passed
```

---

## 十、P1+ 并行执行方案

P0 已全部完成（浏览器扩展 + 搜索增强 + 冲突提示）。剩余 P1/P2/P3 共 9 项任务 + 4 项技术债务，按「零文件交集」原则拆分为两条可并行推进的独立线路。

---

### 依赖矩阵

| 任务 | 主要触及文件 |
|------|-------------|
| P1-4 多格式导入 | `useDataIO.ts`, `useBookmark.ts`, `BookmarkModal.vue` |
| P1-5 公开分享 | `types.ts`, supabase migration, 新增 `/share` 路由, `useDataIO.ts` |
| P1-6 自动同步 | `useCloudSync.ts` |
| P2-7 AI 分类 | 新增 `lib/ai-classify.ts`, `BookmarkModal.vue` |
| P2-8 智能排序 | `data.ts` getter, `ui.ts` |
| P2-9 PWA 离线 | `vite.config.ts`, 新增 Service Worker, `stores/persist.ts` |
| P2-10 生物识别 | `crypto.ts`, `MasterPasswordModal.vue` |
| P3-11 命令面板 | 新增组件, `search.ts` |
| P3-12 分享导入 | `useDataIO.ts`（依赖 P1-5） |
| TD-1 废弃 app store | `stores/app.ts` |
| TD-2 _merge updatedAt | `useCloudSync.ts` |
| TD-3 快速收藏模式 | `useBookmark.ts`, `BookmarkModal.vue` |
| TD-4 搜索缓存 | `data.ts` |

**冲突点**：P1-4、P1-5、P3-12 都改 `useDataIO.ts`；P2-7 和 TD-3 都改 `BookmarkModal.vue`；P2-8 和 TD-4 都改 `data.ts` getter。

---

### Track A — 数据流 + 传播

> **主题**：让数据进得来、出得去、跑得稳
>
> **文件领地**：`useDataIO.ts` · `types.ts` · `supabase/` · `useCloudSync.ts` · `views/ShareView.vue`

| 序号 | 原编号 | 任务 | 说明 | 涉及文件 |
|------|--------|------|------|----------|
| A1 | P1-6 | 自动同步增强 | visibilitychange / online / 首次加载自动触发 | `useCloudSync.ts` |
| A2 | TD-2 | _merge updatedAt | categories/attrs 传入时间戳比较器 | `useCloudSync.ts` |
| A3 | P1-4 | 多格式导入向导 | Chrome HTML / Raindrop JSON / CSV 解析 + 导入 UI | `useDataIO.ts` · `BookmarkModal.vue`（仅导入按钮区） |
| A4 | P1-5 | 公开分享链接 | `is_public` 字段 + RLS 公开策略 + `/share/:id` 只读路由 | `types.ts` · `005_migration.sql` · `views/ShareView.vue` |
| A5 | P3-12 | 导入他人分享 | 公开组一键 fork（复制模式），依赖 A4 | `useDataIO.ts` · `ShareView.vue` |

**执行顺序**：A1 → A2 → A3 → A4 → A5

```
A1 自动同步 ──→ A2 _merge 修复 ──→ A3 多格式导入 ──→ A4 公开分享 ──→ A5 分享导入
   (useCloudSync)    (useCloudSync)     (useDataIO)     (types+RLS)     (ShareView)
```

---

### Track B — 体验 + 智能 + 基建

> **主题**：让产品更聪明、更快、更安全
>
> **文件领地**：`data.ts` · `search.ts` · `crypto.ts` · `BookmarkModal.vue` · `MasterPasswordModal.vue` · `vite.config.ts` · `stores/` · 新组件

| 序号 | 原编号 | 任务 | 说明 | 涉及文件 |
|------|--------|------|------|----------|
| B1 | P2-8 | 智能排序算法 | `useCount × e^(-λ×days)` 时间衰减，新增「推荐」排序 | `data.ts` getter · `ui.ts` |
| B2 | TD-4 | 搜索缓存优化 | getter 增量缓存 Fuse 实例，大数据量不重复计算 | `data.ts` · `search.ts` |
| B3 | TD-3 | 快速收藏模式 | BookmarkModal 精简为仅 URL 必填，自动抓取 title/icon | `useBookmark.ts` · `BookmarkModal.vue`（表单逻辑区） |
| B4 | P2-7 | AI 分类建议 | Transformers.js 本地模型，收藏时建议分类 + 标签 | 新增 `lib/ai-classify.ts` · `BookmarkModal.vue`（表单逻辑区） |
| B5 | P2-10 | 生物识别解锁 | WebAuthn API，指纹/面部替代手动输入主密码 | `crypto.ts` · `MasterPasswordModal.vue` |
| B6 | P2-9 | PWA 离线支持 | Service Worker + 离线操作队列 `pendingOps` | `vite.config.ts` · `stores/persist.ts` |
| B7 | P3-11 | 命令面板 | Cmd+K 统一入口，搜索 + 命令注册 | 新增组件 · `search.ts` |
| B8 | TD-1 | 废弃 app store | 新代码直接用 dataStore/uiStore | `stores/app.ts` |

**执行顺序**：B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8

```
B1 智能排序 ──→ B2 搜索缓存 ──→ B3 快速收藏 ──→ B4 AI 分类
  (data.ts)      (data.ts)     (BookmarkModal)   (BookmarkModal)
                                                      │
B5 生物识别 ──→ B6 PWA 离线 ──→ B7 命令面板 ──→ B8 废弃 app store
 (crypto.ts)    (vite.config)    (新组件)        (stores/app.ts)
```

---

### 并行隔离保证

```
Track A 文件领地                 Track B 文件领地
───────────────────              ───────────────────
useDataIO.ts                     data.ts
types.ts                         search.ts
supabase/migrations/*.sql        ui.ts
useCloudSync.ts                  crypto.ts
views/ShareView.vue (新增)        BookmarkModal.vue
                                 MasterPasswordModal.vue
                                 lib/ai-classify.ts (新增)
                                 vite.config.ts
                                 stores/persist.ts
                                 stores/app.ts
                                 命令面板组件 (新增)

                  ↑ 零文件交集 ↑
```

**唯一共享文件：`BookmarkModal.vue`**

隔离约定：
- **Track A** 仅在模板底部「导入」区域新增按钮 + handler，不动表单逻辑
- **Track B** 仅改表单字段的显隐/预填/保存逻辑，不动导入区域
- 两组改动在文件中占据不同区域，可安全并行

---

### 并行里程碑

```
            Track A（数据流）                    Track B（体验智能）
            ─────────────────                    ─────────────────
第 3 周  ── A1 自动同步 + A2 _merge 修复         B1 智能排序 + B2 搜索缓存
              ↓ 同步可靠、无静默丢失                ↓ 默认排序更智能
第 4 周  ── A3 多格式导入向导                     B3 快速收藏 + B4 AI 分类建议
              ↓ 零门槛迁移                         ↓ 收藏体验质变
第 5 周  ── A4 公开分享链接                       B5 生物识别解锁
              ↓ 内容可传播、SEO 入口                ↓ 安全体验升级
第 6 周  ── A5 导入他人分享                       B6 PWA 离线支持
              ↓ 病毒式增长闭环                      ↓ 全平台离线可用
第 7 周  ── Track A 收尾 + 联调                   B7 命令面板 + B8 废弃 app store
              ↓ 数据层完全体                        ↓ 体验层完全体
第 8 周  ── 双线合并 → 全量回归测试 → 发版
```

---

*最后更新：2026-06-22*
