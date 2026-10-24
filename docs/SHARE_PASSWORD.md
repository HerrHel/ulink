# 分享访问密码（Share Lock）实施与运维

> 状态：代码完成，**待部署验证**
> 目标：让分享链接具备「知道链接 + 知道密码」双重条件，支撑「私有链接」的合规定性（见 `BILLING_DESIGN.md` §8.5）

---

## 1. 设计要点

| 决策 | 原因 |
|---|---|
| 摘要只在**服务端**计算 | 若客户端算好摘要直传，摘要本身就成了可复用凭证，库一泄露即可绕过密码 |
| 未验密时**不读内容** | 内容根本不出库，比「先渲染再遮挡」少一个泄露面 |
| 密码门**与内容缓存键分离** | 否则首个验密者的页面会被缓存给所有后续访客，密码形同虚设 |
| 票据用 HMAC 绑定 gid | A 组的票据不能用于 B 组；改过期时间即验签失败 |
| 密钥缺失 → **503**，不降级 | 宁可功能不可用，也不能「配置错了就当没密码」 |

## 2. 数据模型

```sql
-- 迁移：cloudbase/migrations/20261025000001_share_password.sql
ALTER TABLE public.sibling_groups ADD COLUMN share_password_hash TEXT;
```

- 格式 `scrypt$N$r$p$saltB64$hashB64`；`NULL` 或空串 = 无密码
- **绝不出现在 `get_public_group` 的列白名单里**
- 新 RPC：
  - `get_share_secret(p_gid)` → `{has_password, password_hash}` 或 `NULL`（组不存在/未公开/已删除）
  - `set_share_password(p_gid, p_user_id, p_hash)` → `boolean`
  - 两者 **只 GRANT 给 service_role**，anon/authenticated 不可执行

## 3. 鉴权与流程

### 设置密码（前端 → share-admin）

```
POST https://<fnbase>/share-admin
Authorization: Bearer <CloudBase access_token>
{ "gid": "g1abc...", "password": "明文" | null }     // null = 清除
```

链路：`cb-auth` 离线 RS256 验签 → uid → 限流(20/min) → `set_share_password(gid, uid, scrypt(明文))`
RPC 内再按 `(id, user_id)` 匹配一次 → 非本人返回 false → 403。**双重防越权**。

### 访问分享（访客 → share-ssr）

```
GET  /s/<gid>
  1) get_share_secret(gid)
     ├─ NULL            → 404（不存在/未公开/已删除）
     ├─ has_password=false → 原逻辑（可读内容缓存）
     └─ has_password=true
          ├─ 票据有效 → 渲染内容（不读缓存、不写缓存）
          └─ 票据无效 → 渲染密码门（缓存键 `<url>|gate`）

POST /s/<gid>   (form: password=xxx)
  1) get_share_secret → 无密码则 302 回原页
  2) 限流：10 次 / 10 分钟 / (gid, IP)
  3) scrypt 比对 → 失败 401（密码门 + 错误提示）/ 超限 429
  4) 成功 → Set-Cookie: ulp_<hash12>=v1.<exp>.<hmac>; HttpOnly; Secure; SameSite=Lax
          → 302 回原页
```

## 4. 新增环境变量

| 变量 | 所属函数 | 必需 | 说明 |
|---|---|---|---|
| `SHARE_LOCK_SECRET` | share-ssr | 是（启用密码功能时） | 票据签名密钥，≥32 字节随机串。缺失时带密码的分享直接 503 |
| `SHARE_SSR_IP_HASH_SALT` | share-ssr | 否 | 密码尝试限流的 IP 盐，默认 `ulink-share-ssr` |
| `SHARE_ADMIN_IP_HASH_SALT` | share-admin | 否 | 同上，默认 `ulink-share-admin` |
| `ALLOWED_ORIGINS` | share-admin | 是 | **必须**包含站点源，否则 CORS 拒绝 |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

写入 `.env.local`：`SHARE_LOCK_SECRET=...`

## 5. 部署步骤

```bash
# 1) 迁移（新列 + 两个 RPC；均为幂等 CREATE OR REPLACE）
bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --file cloudbase/migrations/20261025000001_share_password.sql

# 2) 派生云函数资产（share-render / share-lock / cb-auth）
node scripts/build-fn-assets.mjs

# 3) 部署（cwd 必须是仓库根）
node scripts/deploy-cloudbase-fn.mjs share-ssr
node scripts/deploy-cloudbase-fn.mjs share-admin
```

> `share-admin` 是新函数，首次部署会自动创建。路由无需手动配（浏览器直调函数 URL，不走 `/s` 网关）。

## 6. 验证清单

```bash
# ① 未登录调设置接口 → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<fnbase>/share-admin \
  -H 'Content-Type: application/json' -d '{"gid":"g1","password":"abcd"}'

# ② 查询状态（登录态）→ {"ok":true,"has_password":false}
#    前端在 ShareModal 打开时自动调用

# ③ 设置密码后：直接访问分享链接 → 应看到密码门（HTML 中不含任何书签标题）
curl -s https://ulink.ren/s/<gid> | grep -c '<form class="pw-form"'   # 期望 1
curl -s https://ulink.ren/s/<gid> | grep -c 'pw-input'                # 期望 1
curl -s https://ulink.ren/s/<gid> | grep -c 'target="_blank"'         # 期望 0（无书签链接）

# ④ 错误密码 → 401 且仍是密码门
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ulink.ren/s/<gid> -d 'password=wrong'

# ⑤ 正确密码 → 302 + Set-Cookie
curl -s -i -X POST https://ulink.ren/s/<gid> -d 'password=<正确密码>' | grep -i 'set-cookie\|location'

# ⑥ 带票据访问 → 200 且含内容；响应头有 x-share-cache: BYPASS
curl -s -i https://ulink.ren/s/<gid> -H 'Cookie: ulp_xxxx=v1.xxx.xxx' | grep -i 'x-share-cache'

# ⑦ 缓存不串号（关键）：清除 cookie 再访问，必须回到密码门而不是内容
curl -s https://ulink.ren/s/<gid> | grep -c 'pw-form'   # 期望 1
```

**⑦ 是这次改动最该验的一项**——它直接对应「缓存绕过密码」这个安全事故。

## 7. 已知边界

| 项 | 现状 |
|---|---|
| 分类分享（`/s/c/<sid>`） | **尚不支持密码**，POST 返回 405 |
| 密码强度 | 最低 4 位（分享场景，不追求强口令），最长 128 |
| 爆破防护 | 10 次 / 10 分钟 / (gid, IP)，超限 429 |
| 票据有效期 | 24 小时，重新输密码即换新票据 |
| 改密码后 | 旧票据**不会失效**（票据只绑定 gid，不含密码版本）。若需「改密即踢下线」，要在票据里加入密码摘要的前 8 位作为版本号 |
| 忘记密码 | 只能清除后重设（所有者可从 ShareModal 直接改） |

> 「改密码后旧票据仍有效」是刻意取舍：加版本号会让所有既有票据失效，代价与收益需产品确认后再定。

## 8. 回滚

1. 前端回滚 `ShareModal.vue` / `useSharePassword.ts` 即可停止写入；
2. 已设密码的组会继续要求密码——若需全部放行：
   ```sql
   UPDATE public.sibling_groups SET share_password_hash = NULL WHERE share_password_hash IS NOT NULL;
   ```
3. 完整回滚：删列（`DROP COLUMN share_password_hash`）+ 停用 `share-admin` 函数。
