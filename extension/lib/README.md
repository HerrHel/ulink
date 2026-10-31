# extension/lib/

此目录包含扩展所需的兼容库与第三方 bundle。

## supabase.js（CloudBase shim）

`supabase.js` 现在**不是** Supabase 官方 SDK，而是 CloudBase 兼容层：
它把 `@cloudbase/js-sdk`（`cloudbase-sdk.js`，IIFE 挂 `window.CloudBaseSdk`）适配成
`window.supabase.createClient(envId, publishableKey)` 形状，供历史 `sidepanel.js` 调用
（`{ from, auth }`，含 `verifyOtp` 闭包适配）。扩展的认证/数据实际走腾讯云开发 CloudBase，
**不要再安装或打包 `@supabase/supabase-js`**。

## 配置（L2）

`extension/config.js` 集中存放：

- `CLOUDBASE_ENV_ID`：CloudBase 环境 ID（当前 `ulink-d1g5srvjo54b1886a`）；
- `CLOUDBASE_PUBLISHABLE_KEY`：CloudBase publishable key（公开，可放前端；靠 RLS 保护）；
- `MASTER_PASSWORD_TTL_MS`：主密码会话缓存 TTL。

`window.supabase` 只是 CloudBase shim 的兼容命名，**不是 Supabase 后端**，manifest 里也
不应再声明 `https://*.supabase.co/*` 这类历史 host permission。切换环境时改 config.js 一处即可，
切勿写入 service_role / 服务端密钥。
