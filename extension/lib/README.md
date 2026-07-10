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
