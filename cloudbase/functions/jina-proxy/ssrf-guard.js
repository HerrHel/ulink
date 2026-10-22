// 本文件由 scripts/build-fn-assets.mjs 从 supabase/functions/check-link/ssrf-guard.ts 生成，请勿手改
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

// supabase/functions/check-link/ssrf-guard.ts
var ssrf_guard_exports = {};
__export(ssrf_guard_exports, {
  ALLOWED_PORTS: () => ALLOWED_PORTS,
  ALLOWED_PROTOCOLS: () => ALLOWED_PROTOCOLS,
  PRIVATE_LITERAL_HOSTS: () => PRIVATE_LITERAL_HOSTS,
  SsrfRejectError: () => SsrfRejectError,
  buildCorsHeaders: () => buildCorsHeaders,
  isOriginAllowed: () => isOriginAllowed,
  isPrivateHost: () => isPrivateHost,
  isPrivateIPv4: () => isPrivateIPv4,
  isPrivateIPv6: () => isPrivateIPv6,
  isPrivateReject: () => isPrivateReject,
  isRedirectDenied: () => isRedirectDenied,
  isTargetDnsSafeSyncResults: () => isTargetDnsSafeSyncResults,
  parseIPv4Hostname: () => parseIPv4Hostname,
  parseIPv6Hostname: () => parseIPv6Hostname,
  validateUrlShape: () => validateUrlShape
});
module.exports = __toCommonJS(ssrf_guard_exports);
var PRIVATE_LITERAL_HOSTS = /* @__PURE__ */ new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata"
]);
function isPrivateIPv4(octets) {
  if (octets.length !== 4 || octets.some((o) => o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}
function isPrivateIPv6(hextets) {
  if (hextets.length !== 8) return false;
  const a = hextets[0];
  const b = hextets[1];
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true;
  if (hextets.every((h) => h === 0)) return true;
  if ((a & 65024) === 64512) return true;
  if ((a & 65472) === 65152) return true;
  if (a === 8193 && b === 3512) return true;
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 65535) {
    const ipv4 = [hextets[6] >> 8 & 255, hextets[6] & 255, hextets[7] >> 8 & 255, hextets[7] & 255];
    return isPrivateIPv4(ipv4);
  }
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0) {
    const ipv4 = [hextets[6] >> 8 & 255, hextets[6] & 255, hextets[7] >> 8 & 255, hextets[7] & 255];
    return isPrivateIPv4(ipv4);
  }
  return false;
}
function parseIPv4Hostname(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (m) {
    const octets = m.slice(1).map(Number);
    if (octets.some((o) => Number.isNaN(o) || o > 255)) return null;
    return octets;
  }
  const mm = /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.exec(hostname);
  if (mm) {
    const isHex = /^0x/i.test(hostname);
    const isOct = /^0[0-7]+$/i.test(hostname);
    const base = isHex ? 16 : isOct ? 8 : 10;
    const n = parseInt(hostname, base);
    if (Number.isNaN(n) || n < 0 || n > 4294967295) return null;
    return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  }
  return null;
}
function parseIPv6Hostname(hostname) {
  let h = hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h.includes(":")) return null;
  const parts = h.split("::");
  if (parts.length > 2) return null;
  function expandLastDottedQuad(segs2) {
    if (segs2.length === 0) return segs2;
    const last = segs2[segs2.length - 1];
    if (last.includes(".")) {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(last);
      if (!m) return null;
      const octets = m.slice(1).map(Number);
      if (octets.some((o) => Number.isNaN(o) || o > 255)) return null;
      const hi = octets[0] << 8 | octets[1];
      const lo = octets[2] << 8 | octets[3];
      return [...segs2.slice(0, -1), hi.toString(16), lo.toString(16)];
    }
    return segs2;
  }
  if (parts.length === 2) {
    let left = parts[0] ? parts[0].split(":") : [];
    let right = parts[1] ? parts[1].split(":") : [];
    left = expandLastDottedQuad(left);
    right = expandLastDottedQuad(right);
    if (left === null || right === null) return null;
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    h = [...left, ...Array(fill).fill("0"), ...right].join(":");
  } else {
    const segs2 = expandLastDottedQuad(parts[0].split(":"));
    if (segs2 === null) return null;
    h = segs2.join(":");
  }
  const segs = h.split(":");
  if (segs.length !== 8) return null;
  const hextets = segs.map((s) => {
    const v = parseInt(s, 16);
    return Number.isNaN(v) || v < 0 || v > 65535 ? null : v;
  });
  if (hextets.some((x) => x === null)) return null;
  return hextets;
}
function isPrivateHost(hostname) {
  let lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) lower = lower.slice(1, -1);
  if (PRIVATE_LITERAL_HOSTS.has(lower)) return true;
  const ipv4 = parseIPv4Hostname(lower);
  if (ipv4) return isPrivateIPv4(ipv4);
  const ipv6 = parseIPv6Hostname(lower);
  if (ipv6) return isPrivateIPv6(ipv6);
  return false;
}
function isTargetDnsSafeSyncResults(hostname, records) {
  if (!records.length) return false;
  for (const r of records) {
    if (isPrivateHost(r)) return false;
  }
  return true;
}
var ALLOWED_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
var ALLOWED_PORTS = /* @__PURE__ */ new Set(["", "80", "443"]);
var SsrfRejectError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "SsrfRejectError";
    this.code = code;
  }
};
function isPrivateReject(error) {
  const code = error?.code;
  return code === "private_host" || code === "private_dns";
}
function isRedirectDenied(error) {
  return error?.code === "redirect_denied";
}
function validateUrlShape(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL \u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error("URL \u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934");
  if (parsed.username || parsed.password) throw new Error("URL \u4E0D\u5F97\u5305\u542B\u8BA4\u8BC1\u4FE1\u606F");
  if (!ALLOWED_PORTS.has(parsed.port)) throw new Error("\u4EC5\u5141\u8BB8 80/443 \u7AEF\u53E3");
  if (isPrivateHost(parsed.hostname)) throw new SsrfRejectError("private_host", "\u4E0D\u5141\u8BB8\u8BBF\u95EE\u5185\u7F51\u5730\u5740");
  return parsed;
}
function isOriginAllowed(origin, allowed) {
  if (!origin || allowed.length === 0) return false;
  return allowed.includes(origin);
}
function buildCorsHeaders(origin, allowed) {
  const headers = { "Vary": "Origin" };
  if (isOriginAllowed(origin, allowed)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
  }
  return headers;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALLOWED_PORTS,
  ALLOWED_PROTOCOLS,
  PRIVATE_LITERAL_HOSTS,
  SsrfRejectError,
  buildCorsHeaders,
  isOriginAllowed,
  isPrivateHost,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateReject,
  isRedirectDenied,
  isTargetDnsSafeSyncResults,
  parseIPv4Hostname,
  parseIPv6Hostname,
  validateUrlShape
});
