# extension/lib/

此目录包含扩展所需的第三方库 bundle 文件。

## supabase.js

`supabase.js` 是 `@supabase/supabase-js` 的预编译 bundle，被 `sidepanel.html`
以 `<script>` 标签加载。因 Chrome 扩展的 Content Security Policy 限制（不允许
`eval` 及动态 import），无法直接使用 npm 包，故需要单独打包。

### 重新生成

```bash
npm install
npx esbuild --bundle --format=iife --global-name=supabase \
  --outfile=extension/lib/supabase.js \
  --define:process.env.NODE_ENV=\"production\" \
  @supabase/supabase-js
```

生成的 `supabase.js` 会暴露 `window.supabase.createClient()` 供 sidepanel.js 使用。

## 配置（L2）

`extension/config.js` 集中存放 `SUPABASE_URL` / `SUPABASE_ANON_KEY`（与主项目
`.env` 的 `VITE_SUPABASE_*` 对齐）。sidepanel 通过 `window.LinkVaultExtConfig` 读取。
轮换 anon key 或切换项目时改 config.js 一处即可，无需改 sidepanel 业务代码。
**切勿写入 service_role key**（anon key 本就公开，靠 RLS 保护）。
