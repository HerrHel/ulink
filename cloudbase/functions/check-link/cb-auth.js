// 本文件由 scripts/build-fn-assets.mjs 从 supabase/functions/_shared/cb-auth.ts 生成，请勿手改
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// supabase/functions/_shared/cb-auth.ts
var cb_auth_exports = {};
__export(cb_auth_exports, {
  clearJwksCache: () => clearJwksCache,
  extractBearer: () => extractBearer,
  fetchJwks: () => fetchJwks,
  jwksUrl: () => jwksUrl,
  parseJwt: () => parseJwt,
  resolveViaUserinfo: () => resolveViaUserinfo,
  userinfoUrl: () => userinfoUrl,
  verifyCbToken: () => verifyCbToken,
  verifyJwtWithJwks: () => verifyJwtWithJwks
});
module.exports = __toCommonJS(cb_auth_exports);
var import_node_crypto = require("node:crypto");
function extractBearer(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(headerValue);
  return m ? m[1] : null;
}
function parseJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const signature = parts[2] ? Buffer.from(parts[2], "base64url") : Buffer.alloc(0);
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature
  };
}
function verifyJwtWithJwks(token, jwks, opts = {}) {
  const now = opts.now ?? Date.now();
  const tol = (opts.clockToleranceSec ?? 60) * 1e3;
  const parsed = parseJwt(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.header.alg !== "RS256") {
    return { ok: false, reason: "bad_alg", detail: String(parsed.header.alg ?? "none") };
  }
  const exp = parsed.payload.exp;
  if (typeof exp === "number" && exp * 1e3 + tol < now) {
    return { ok: false, reason: "expired" };
  }
  const nbf = parsed.payload.nbf;
  if (typeof nbf === "number" && nbf * 1e3 - tol > now) {
    return { ok: false, reason: "rejected", detail: "nbf in future" };
  }
  const kid = typeof parsed.header.kid === "string" ? parsed.header.kid : "";
  const jwk = kid ? jwks.find((k) => k.kid === kid) : (
    // 无 kid 时，仅当公钥集只有一把时才敢用（避免多密钥下猜错）
    jwks.length === 1 ? jwks[0] : void 0
  );
  if (!jwk) return { ok: false, reason: "unknown_kid", detail: kid || "(no kid)" };
  let verified = false;
  try {
    const key = (0, import_node_crypto.createPublicKey)({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
    const verifier = (0, import_node_crypto.createVerify)("RSA-SHA256");
    verifier.update(parsed.signingInput);
    verifier.end();
    verified = verifier.verify(key, parsed.signature);
  } catch (e) {
    return { ok: false, reason: "bad_signature", detail: e.message };
  }
  if (!verified) return { ok: false, reason: "bad_signature" };
  const sub = parsed.payload.sub;
  if (typeof sub !== "string" || sub.trim() === "") {
    return { ok: false, reason: "no_sub" };
  }
  return { ok: true, uid: sub, claims: parsed.payload, mode: "offline" };
}
var JWKS_CACHE = /* @__PURE__ */ new Map();
var JWKS_TTL_MS = 60 * 60 * 1e3;
function clearJwksCache(envIdPrefix) {
  if (!envIdPrefix) JWKS_CACHE.clear();
  else {
    for (const k of JWKS_CACHE.keys()) {
      if (k.startsWith(envIdPrefix)) JWKS_CACHE.delete(k);
    }
  }
}
function jwksUrl(envId) {
  return `https://${envId}.api.tcloudbasegateway.com/auth/v1/certs`;
}
function userinfoUrl(envId) {
  return `https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`;
}
async function fetchJwks(envId, force = false) {
  const key = `jwks:${envId}`;
  const now = Date.now();
  const hit = JWKS_CACHE.get(key);
  if (!force && hit && hit.expiresAt > now) return hit.keys;
  const res = await fetch(jwksUrl(envId), {
    headers: { accept: "application/json" }
  });
  if (!res.ok) throw new Error(`jwks http ${res.status}`);
  const body = await res.json();
  const raw = Array.isArray(body?.keys) ? body.keys : [];
  const keys = raw.filter(
    (k) => k && k.kty === "RSA" && typeof k.n === "string" && typeof k.e === "string" && // 未标 use 的视为签名密钥（网关实际就是这么返回的）
    (k.use === void 0 || k.use === "sig")
  ).map((k) => ({
    kid: typeof k.kid === "string" ? k.kid : "",
    kty: "RSA",
    alg: typeof k.alg === "string" ? k.alg : void 0,
    n: k.n,
    e: k.e
  }));
  if (keys.length === 0) throw new Error("jwks empty");
  JWKS_CACHE.set(key, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}
async function resolveViaUserinfo(token, envId) {
  const res = await fetch(userinfoUrl(envId), {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (!res.ok) return null;
  const body = await res.json();
  const user = body.user && typeof body.user === "object" ? body.user : body;
  const uid = typeof user.sub === "string" && user.sub || typeof user.id === "string" && user.id || typeof user.user_id === "string" && user.user_id || "";
  if (!uid) return null;
  return { uid, claims: user };
}
async function verifyCbToken(authHeader, opts) {
  const token = extractBearer(authHeader);
  if (!token) return { ok: false, reason: "missing" };
  let offline = null;
  if (parseJwt(token)) {
    const loadKeys = async (force) => opts.jwksLoader ? opts.jwksLoader() : fetchJwks(opts.envId, force);
    let keys = null;
    try {
      keys = await loadKeys(false);
    } catch (e) {
      offline = { ok: false, reason: "unknown_kid", detail: `jwks fetch: ${e.message}` };
    }
    if (keys) {
      offline = verifyJwtWithJwks(token, keys, {
        now: opts.now,
        clockToleranceSec: opts.clockToleranceSec
      });
      if (!offline.ok && offline.reason === "unknown_kid") {
        try {
          offline = verifyJwtWithJwks(token, await loadKeys(true), {
            now: opts.now,
            clockToleranceSec: opts.clockToleranceSec
          });
        } catch {
        }
      }
      if (offline.ok) return offline;
    }
  }
  if (opts.allowUserinfoFallback !== false) {
    try {
      const info = await (opts.userinfoFetcher ? opts.userinfoFetcher(token) : resolveViaUserinfo(token, opts.envId));
      if (info?.uid) {
        return { ok: true, uid: info.uid, claims: info.claims, mode: "userinfo" };
      }
    } catch {
    }
  }
  return offline ?? { ok: false, reason: "malformed" };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  clearJwksCache,
  extractBearer,
  fetchJwks,
  jwksUrl,
  parseJwt,
  resolveViaUserinfo,
  userinfoUrl,
  verifyCbToken,
  verifyJwtWithJwks
});
