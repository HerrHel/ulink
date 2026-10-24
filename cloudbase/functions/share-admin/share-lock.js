// 本文件由 scripts/build-fn-assets.mjs 从 supabase/functions/_shared/share-lock.ts 生成，请勿手改
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

// supabase/functions/_shared/share-lock.ts
var share_lock_exports = {};
__export(share_lock_exports, {
  PASSWORD_MAX_LEN: () => PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN: () => PASSWORD_MIN_LEN,
  TICKET_TTL_SEC: () => TICKET_TTL_SEC,
  buildTicketCookie: () => buildTicketCookie,
  checkTicket: () => checkTicket,
  clearTicketCookie: () => clearTicketCookie,
  hashPassword: () => hashPassword,
  makeTicket: () => makeTicket,
  parseCookies: () => parseCookies,
  ticketCookieName: () => ticketCookieName,
  validatePasswordInput: () => validatePasswordInput,
  verifyPassword: () => verifyPassword
});
module.exports = __toCommonJS(share_lock_exports);
var import_node_crypto = require("node:crypto");
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 32;
var SALT_LEN = 16;
var TICKET_TTL_SEC = 24 * 60 * 60;
var PASSWORD_MIN_LEN = 4;
var PASSWORD_MAX_LEN = 128;
function validatePasswordInput(pw) {
  if (typeof pw !== "string") return { ok: false, reason: "not_string" };
  if (pw.length < PASSWORD_MIN_LEN) return { ok: false, reason: "too_short" };
  if (pw.length > PASSWORD_MAX_LEN) return { ok: false, reason: "too_long" };
  return { ok: true };
}
function hashPassword(password) {
  const salt = (0, import_node_crypto.randomBytes)(SALT_LEN);
  const key = (0, import_node_crypto.scryptSync)(password.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
function verifyPassword(password, stored) {
  if (typeof password !== "string" || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (N > 1 << 20 || r > 32 || p > 16) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual;
  try {
    actual = (0, import_node_crypto.scryptSync)(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * 1024 * 1024
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return (0, import_node_crypto.timingSafeEqual)(actual, expected);
}
function makeTicket(gid, secret, nowMs, ttlSec = TICKET_TTL_SEC) {
  if (!secret) throw new Error("SHARE_LOCK_SECRET \u672A\u914D\u7F6E");
  const exp = Math.floor((nowMs ?? Date.now()) / 1e3) + ttlSec;
  const sig = (0, import_node_crypto.createHmac)("sha256", secret).update(`v1|${gid}|${exp}`).digest("base64url");
  return `v1.${exp}.${sig}`;
}
function checkTicket(ticket, gid, secret, nowMs) {
  if (!ticket || !secret) return false;
  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp)) return false;
  if (exp * 1e3 + 3e4 < (nowMs ?? Date.now())) return false;
  const expected = (0, import_node_crypto.createHmac)("sha256", secret).update(`v1|${gid}|${exp}`).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return (0, import_node_crypto.timingSafeEqual)(a, b);
}
function ticketCookieName(gid) {
  const h = (0, import_node_crypto.createHash)("sha256").update(String(gid)).digest("hex").slice(0, 12);
  return `ulp_${h}`;
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const seg of header.split(";")) {
    const idx = seg.indexOf("=");
    if (idx < 0) continue;
    const k = seg.slice(0, idx).trim();
    const v = seg.slice(idx + 1).trim();
    if (!k || k in out) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}
function buildTicketCookie(gid, ticket, maxAgeSec = TICKET_TTL_SEC) {
  return [
    `${ticketCookieName(gid)}=${encodeURIComponent(ticket)}`,
    "Path=/",
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}
function clearTicketCookie(gid) {
  return `${ticketCookieName(gid)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  TICKET_TTL_SEC,
  buildTicketCookie,
  checkTicket,
  clearTicketCookie,
  hashPassword,
  makeTicket,
  parseCookies,
  ticketCookieName,
  validatePasswordInput,
  verifyPassword
});
