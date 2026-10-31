# LinkVault CLI

> ⚠️ **现状（2026-10-31）**：CLI 仍以 **Supabase** 为目标（依赖 `@supabase/supabase-js`，下方快速开始也是 `https://your-project.supabase.co`）。主项目后端已于 2026-10-22 全量迁到 CloudBase，CLI **未适配**——连现网 Supabase 只能读到迁移前的历史数据。当前定位：参考实现/历史工具，不要用它操作生产。
> 另：`auth verify <email> <token>`（非交互式登录，脚本可用）在下方命令表里漏了。

LinkVault 书签管理器的命令行工具。

## 安装

```bash
cd cli
npm install
npm run build
npm link  # 可选，全局安装
```

## 快速开始

```bash
# 1. 配置连接
linkvault config set-url https://your-project.supabase.co
linkvault config set-key your-anon-key

# 2. 登录（写操作需要）
linkvault auth login your@email.com

# 3. 开始使用
linkvault bookmarks list
```

## 完整命令列表

### 配置管理 (`config`)

| 命令 | 说明 |
|------|------|
| `config set-url <url>` | 设置 Supabase URL |
| `config set-key <key>` | 设置 API Key |
| `config show` | 显示当前配置 |
| `config test` | 测试连接 |

### 认证 (`auth`)

| 命令 | 说明 |
|------|------|
| `auth login <email>` | 登录（Email OTP） |
| `auth logout` | 登出 |
| `auth whoami` | 显示当前用户 |

### 分类 (`categories`)

| 命令 | 说明 |
|------|------|
| `categories list` | 列出所有分类 |
| `categories create -n <name>` | 创建分类 |
| `categories update <id>` | 更新分类 |
| `categories delete <id>` | 删除分类 |

### 书签 (`bookmarks`)

| 命令 | 说明 |
|------|------|
| `bookmarks list` | 列出书签 |
| `bookmarks list --cat <id>` | 按分类筛选 |
| `bookmarks list --sort <mode>` | 排序 (alpha/use/date/order) |
| `bookmarks get <id>` | 查看书签详情 |
| `bookmarks add -t <title> -u <url>` | 添加书签 |
| `bookmarks update <id>` | 更新书签 |
| `bookmarks delete <id>` | 删除书签 |
| `bookmarks move <id> -c <catId>` | 移动书签 |

### 组 (`groups`)

| 命令 | 说明 |
|------|------|
| `groups list` | 列出所有组 |
| `groups get <id>` | 查看组详情 |
| `groups create -n <name>` | 创建组 |
| `groups update <id>` | 更新组 |
| `groups delete <id>` | 删除组 |
| `groups add-bookmark <gId> <bId>` | 添加书签到组 |
| `groups remove-bookmark <gId> <bId>` | 从组移除书签 |

### 搜索 (`search`)

| 命令 | 说明 |
|------|------|
| `search <query>` | 搜索书签和组 |

### 导入导出 (`import`/`export`)

| 命令 | 说明 |
|------|------|
| `export json [-o file]` | 导出为 JSON |
| `export csv [-o file]` | 导出为 CSV |
| `import json <file>` | 从 JSON 导入 |
| `import csv <file>` | 从 CSV 导入 |

### 云端同步 (`sync`)

| 命令 | 说明 |
|------|------|
| `sync status` | 查看同步状态 |
| `sync pull [-o file]` | 从云端拉取 |
| `sync push <file>` | 推送到云端 |
| `sync conflict` | 查看冲突 |

### 本地备份 (`backup`)

| 命令 | 说明 |
|------|------|
| `backup create` | 创建备份 |
| `backup list` | 列出备份 |
| `backup restore <file>` | 从备份恢复 |
| `backup delete <file>` | 删除备份 |
| `backup dir` | 显示备份目录 |

### 维护诊断 (`maintenance`)

| 命令 | 说明 |
|------|------|
| `maintenance check-links` | 检测死链 |
| `maintenance check-links --fix` | 检测并删除死链 |
| `maintenance validate` | 校验数据完整性 |
| `maintenance validate --fix` | 校验并修复问题 |
| `maintenance stats` | 显示统计信息 |
| `maintenance storage` | 显示存储信息 |

### 属性标签 (`tags`)

| 命令 | 说明 |
|------|------|
| `tags list` | 列出所有标签 |
| `tags create -n <name>` | 创建标签 |
| `tags delete <id>` | 删除标签 |
| `tags assign <bmId> <tag>` | 给书签添加标签 |
| `tags unassign <bmId> <tag>` | 移除书签标签 |

### 分享管理 (`share`)

| 命令 | 说明 |
|------|------|
| `share list` | 列出已分享的组 |
| `share enable <groupId>` | 启用组分享 |
| `share disable <groupId>` | 禁用组分享 |

### 输出格式

所有查询命令支持 `--format json`：

```bash
linkvault bookmarks list --format json
```

## 开发

```bash
npm run dev      # 开发模式
npm run build    # 编译
npm run typecheck # 类型检查
```

## License

MIT
