# TypeScript 迁移计划 — 任务 A：基础设施层

## 概述

**目标**：将项目基础设施层从 JavaScript 迁移到 TypeScript

**范围**：配置、类型定义、工具函数、加密模块、Lib 层

**依赖**：无（本任务不依赖任务 B 的任何文件）

**预计工时**：2-3 小时

---

## 迁移文件清单

### 第一阶段：TypeScript 配置（30 分钟）

#### 1.1 安装依赖
```bash
npm install -D typescript @vue/tsconfig
```

#### 1.2 创建 tsconfig.json
```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vite/client", "vitest/globals"]
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "src/**/*.vue"
  ],
  "exclude": ["node_modules", "dist"]
}
```

#### 1.3 创建 src/env.d.ts
```typescript
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

#### 1.4 更新 vite.config.js → vite.config.ts
- 重命名文件
- 添加 TypeScript 类型注解
- 确保构建正常

#### 1.5 更新 vitest.config.js → vitest.config.ts
- 重命名文件
- 添加 TypeScript 类型注解
- 确保测试正常

---

### 第二阶段：类型定义（30 分钟）

#### 2.1 迁移 config/types.d.js → src/types.ts

**当前状态**：使用 JSDoc @typedef

**迁移步骤**：
1. 创建 `src/types.ts`
2. 将 JSDoc 类型转换为 TypeScript 接口
3. 导出所有类型定义

**类型定义**：
```typescript
export interface Bookmark {
  id: string
  title: string
  url: string
  username: string
  password: string | EncryptedPassword
  notes: string
  icon: string
  categoryId: string
  parentId: string | null
  order: number
  useCount: number
  attributes: Record<string, boolean>
  isExpanded: boolean
  createdAt: number
}

export interface EncryptedPassword {
  iv: number[]
  data: number[]
  salt: number[]
  encrypted: true
}

export interface SiblingGroup {
  id: string
  name: string
  categoryId: string
  icon: string
  order: number
  isExpanded: boolean
  attributes: Record<string, boolean>
  bookmarkIds: string[]
  notes: string
  updatedAt: number
  useCount: number
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
}

export interface CustomAttribute {
  id: string
  name: string
  type: 'boolean'
}

export interface AppData {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
}
```

#### 2.2 更新所有类型导入
- 将 `import('../types.d.js')` 改为 `import { ... } from '../types'`
- 更新 JSDoc 注释中的类型引用

---

### 第三阶段：配置文件（20 分钟）

#### 3.1 迁移 config/constants.js → config/constants.ts

**迁移步骤**：
1. 重命名文件
2. 添加类型注解
3. 导出常量类型

**类型注解**：
```typescript
export const STORAGE_KEY: string = 'linkvault_v2'
export const CAT_ALL: string = 'all'
export const CAT_UNCATEGORIZED: string = 'uncategorized'
export const ATTR_IS_GROUP: string = 'is-group'
export const MAX_SUGGESTIONS: number = 8
export const TOAST_FADE_MS: number = 2200
export const TOAST_REMOVE_MS: number = 2600
export const PAYLOAD_KEY: string = 'application/x-linkvault'
export const DRAG_SRC_DETAIL: string = '__detail__'
export const UI_STATE_KEY: string = 'lv_uiState'
export const MAX_UNDO: number = 20
export const UNDO_WINDOW: number = 500
export const MAX_UNDO_BYTES: number = 512 * 1024

export const ACTIONS: Record<string, string> = { ... }

export const DEFAULTS: AppData = { ... }
```

#### 3.2 迁移 config/icons.js → config/icons.ts

**迁移步骤**：
1. 重命名文件
2. 添加类型注解
3. 导出图标类型

**类型注解**：
```typescript
export interface IconMap {
  [key: string]: string
}

export const I: IconMap = { ... }

export function getCategoryIcon(icon: string): string
```

---

### 第四阶段：工具函数（30 分钟）

#### 4.1 迁移 utils.js → utils.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 添加变量类型注解

**函数签名**：
```typescript
export function gid(): string
export function domain(url: string): string
export function favicon(url: string, customIcon?: string): string
export function fixUrl(u: string): string
export function esc(s: string): string
export function sanitizeHTML(html: string): string
export function cleanZeroWidth(text: string): string
export function swapOrder(a: { order: number }, b: { order: number }): void
export function copyToClipboard(text: string, label?: string): void
export function isMobile(): boolean
export function getTagNames(item: Bookmark | SiblingGroup, customAttributes: CustomAttribute[]): string[]
export function createCategory(name: string): Category
export function addNewCategory(name: string, store: AppStore): Category | null
export function stripEntranceAnim(el: HTMLElement | null): (() => void) | null
```

---

### 第五阶段：加密模块（20 分钟）

#### 5.1 迁移 crypto.js → crypto.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 添加变量类型注解

**函数签名**：
```typescript
export function safeAtob(s: string): string
export async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey>
export async function encryptPassword(password: string, masterPassword: string): Promise<EncryptedPassword>
export async function decryptPassword(stored: EncryptedPassword, masterPassword: string): Promise<string>
export function detectPasswordFormat(password: string | EncryptedPassword): 'empty' | 'encrypted' | 'base64' | 'plaintext'
export async function autoMigratePassword(storedPassword: string | EncryptedPassword, masterPassword: string): Promise<string>
export async function safeDecodePassword(storedPassword: string | EncryptedPassword, masterPassword: string): Promise<string>
```

---

### 第六阶段：Lib 层（30 分钟）

#### 6.1 迁移 lib/toast.js → lib/toast.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型

**函数签名**：
```typescript
export function toast(msg: string, ok?: boolean): void
export function toastWithUndo(msg: string, undoFn: () => void, duration?: number): void
export function showConfirm(msg: string, onConfirm: () => void): void
```

#### 6.2 迁移 lib/theme.js → lib/theme.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 添加变量类型注解

**函数签名**：
```typescript
export function toggleTheme(): void
export function setThemeStyle(style: string): void
export function toggleAutoTheme(): void
```

#### 6.3 迁移 lib/editor.js → lib/editor.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 添加 EditorManager 接口

**接口定义**：
```typescript
import type { Editor } from '@tiptap/core'

interface EditorManager {
  register(gid: string, editor: Editor): void
  unregister(gid: string): void
  get(gid: string): Editor | null
  getContentHTML(gid: string): string | null
  insertInlineCardHTML(gid: string, html: string): boolean
  toggleBold(gid: string): void
  setHeading(gid: string, level: number): void
  deleteNode(gid: string, attrName: string, attrValue: string): void
  insertAtCoords(gid: string, html: string, clientX: number, clientY: number): boolean
  insertText(gid: string, text: string): boolean
}

export const EditorManager: EditorManager
```

---

## 验证检查点

### 每个阶段完成后验证

1. **TypeScript 编译检查**
   ```bash
   npx tsc --noEmit
   ```

2. **ESLint 检查**
   ```bash
   npm run lint
   ```

3. **测试运行**
   ```bash
   npm run test
   ```

4. **开发服务器**
   ```bash
   npm run dev
   ```

---

## 依赖关系

### 本任务不依赖的文件
- `stores/*.js`（任务 B 负责）
- `composables/**/*.js`（任务 B 负责）
- `components/**/*.vue`（任务 B 负责）
- `__tests__/**/*.test.js`（任务 B 负责）

### 本任务产生的依赖
- `src/types.ts`（任务 B 需要导入）
- `config/constants.ts`（任务 B 需要导入）
- `config/icons.ts`（任务 B 需要导入）
- `utils.ts`（任务 B 需要导入）
- `crypto.ts`（任务 B 需要导入）
- `lib/*.ts`（任务 B 需要导入）

---

## 注意事项

### 1. 渐进式迁移
- 保持 `.js` 文件可用，直到所有依赖都迁移完成
- 使用 `allowJs: true` 在 tsconfig.json 中支持混合文件

### 2. 类型导入
- 使用 `import type` 导入类型，避免运行时开销
- 示例：`import type { Bookmark } from '../types'`

### 3. JSDoc 到 TypeScript
- 将 JSDoc `@typedef` 转换为 TypeScript `interface`
- 将 JSDoc `@param` 和 `@returns` 转换为函数签名
- 保留必要的 JSDoc 注释用于文档

### 4. 第三方库类型
- 检查 `@types/*` 包是否可用
- 对于没有类型的库，创建 `.d.ts` 声明文件

---

## 产出物

### 新增文件
- `tsconfig.json`
- `src/env.d.ts`
- `src/types.ts`
- `config/constants.ts`
- `config/icons.ts`
- `utils.ts`
- `crypto.ts`
- `lib/toast.ts`
- `lib/theme.ts`
- `lib/editor.ts`
- `vite.config.ts`
- `vitest.config.ts`

### 修改文件
- `package.json`（添加 TypeScript 依赖）

### 删除文件
- `config/types.d.js`
- `config/constants.js`
- `config/icons.js`
- `utils.js`
- `crypto.js`
- `lib/toast.js`
- `lib/theme.js`
- `lib/editor.js`
- `vite.config.js`
- `vitest.config.js`
