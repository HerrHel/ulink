// 本文件由 scripts/build-probe-pages.mjs 从 functions/api/check-link.ts 生成，请勿手改
// functions/_lib/cf-guard.ts
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://ulink.ren",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174"
]);
var OIDC_USERINFO_URL = "https://ulink-d1g5srvjo54b1886a.api.tcloudbasegateway.com/auth/v1/user/me";
var AUTH_TIMEOUT_MS = 8e3;
function isAllowedOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return ALLOWED_ORIGINS.has(parsed.origin);
}
function cfCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!origin || !isAllowedOrigin(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ulink-Trace-Id"
  };
}
function guardError(status, error, cors) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors ?? {}
    }
  });
}
function cfPreflightResponse(request) {
  const origin = request.headers.get("Origin");
  const cors = cfCorsHeaders(request);
  if (origin && !cors) {
    return guardError(403, "origin_forbidden");
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors ?? {},
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}
var RATE_WINDOW_MS = 6e4;
var DEFAULT_RATE_LIMIT = 60;
var rateBuckets = /* @__PURE__ */ new Map();
function rateLimitKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const origin = request.headers.get("Origin") || "";
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = "";
  }
  return `${ip || origin || "anonymous"}|${pathname}`;
}
function isRateLimited(key, limit) {
  if (limit <= 0) return false;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateBuckets.size > 1024) {
      for (const [k, v] of rateBuckets) {
        if (now >= v.resetAt) rateBuckets.delete(k);
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}
async function guardCfRequest(request, opts = {}) {
  const origin = request.headers.get("Origin");
  const cors = cfCorsHeaders(request);
  if (isRateLimited(rateLimitKey(request), opts.rateLimit ?? DEFAULT_RATE_LIMIT)) {
    return guardError(429, "rate_limited", cors ?? void 0);
  }
  if (opts.requireAuth === true) {
    const authHeader = request.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+/i.test(authHeader)) {
      return guardError(401, "unauthorized", cors ?? void 0);
    }
    try {
      const verifyRes = await fetch(OIDC_USERINFO_URL, {
        method: "GET",
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
      });
      if (!verifyRes.ok) {
        return guardError(401, "unauthorized", cors ?? void 0);
      }
    } catch {
      return guardError(401, "unauthorized", cors ?? void 0);
    }
  }
  if (origin && !cors) return guardError(403, "origin_forbidden");
  return null;
}

// supabase/functions/check-link/ssrf-guard.ts
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

// functions/_lib/probe-core.ts
var PRIVATE_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"]);
function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}
function isPrivateHost2(hostname) {
  const host = normalizeHost(hostname);
  if (PRIVATE_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isPrivateHost(host);
}
async function dohAnswer(host, type) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: controller.signal }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Answer || []).filter((a) => (a.type === 1 || a.type === 28) && typeof a.data === "string").map((a) => String(a.data));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
async function checkHostSafety(hostname) {
  const host = normalizeHost(hostname);
  if (isPrivateHost2(host)) return "private";
  if (parseIPv4Hostname(host) || parseIPv6Hostname(host)) return "ok";
  const [v4, v6] = await Promise.all([dohAnswer(host, "A"), dohAnswer(host, "AAAA")]);
  const all = [...v4, ...v6];
  if (all.length === 0) return "nxdomain";
  return all.every((ip) => !isPrivateHost2(ip)) ? "ok" : "private";
}
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors ?? {}
    }
  });
}
async function handleProbe(request, opts = {}) {
  const cors = cfCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return cfPreflightResponse(request);
  }
  if (opts.requireOrigin && !request.headers.get("Origin")) {
    return jsonResponse({ error: "origin_required" }, 403, null);
  }
  const guard = await guardCfRequest(request, { requireAuth: false });
  if (guard) return guard;
  let rawUrl = "";
  if (request.method === "POST") {
    try {
      const body = await request.json();
      rawUrl = body.url || "";
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400, cors);
    }
  } else {
    const parsed = new URL(request.url);
    rawUrl = parsed.searchParams.get("url") || "";
  }
  if (!rawUrl || !rawUrl.startsWith("http")) {
    return jsonResponse({ error: "invalid_url", outcome: "dead", status: 0 }, 400, cors);
  }
  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return jsonResponse({ error: "invalid_url_format", outcome: "dead", status: 0 }, 400, cors);
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return jsonResponse({ error: "private_ip_forbidden", outcome: "error", status: 0 }, 400, cors);
  }
  const initialSafety = await checkHostSafety(targetUrl.hostname);
  if (initialSafety === "private") {
    return jsonResponse({ error: "private_ip_forbidden", outcome: "error", status: 0 }, 400, cors);
  }
  if (initialSafety === "nxdomain") {
    return jsonResponse({ ok: false, outcome: "dead", status: 0, reason: "dns_nxdomain" }, 200, cors);
  }
  const timeoutMs = opts.timeoutMs ?? 5e3;
  const MAX_REDIRECTS = 3;
  const REDIRECT_CODES = [301, 302, 303, 307, 308];
  const fetchGuarded = async (start, method, signal) => {
    let current = start;
    for (let hop = 0; ; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new Error("unsafe_redirect");
      }
      if (await checkHostSafety(current.hostname) !== "ok") {
        throw new Error("unsafe_redirect");
      }
      const res = await fetch(current.href, {
        method,
        redirect: "manual",
        signal,
        headers: { "User-Agent": BROWSER_UA }
      });
      const loc = REDIRECT_CODES.includes(res.status) ? res.headers.get("Location") : null;
      if (loc && hop < MAX_REDIRECTS) {
        let next;
        try {
          next = new URL(loc, current.href);
        } catch {
          return res;
        }
        current = next;
        continue;
      }
      return res;
    }
  };
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = null;
    try {
      response = await fetchGuarded(targetUrl, "HEAD", controller.signal);
    } catch (headErr) {
      if (headErr?.name === "AbortError") {
        return jsonResponse({ ok: false, outcome: "timeout", status: 0 }, 200, cors);
      }
    }
    if (!response || [400, 401, 403, 404, 405, 501].includes(response.status)) {
      clearTimeout(timer);
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchGuarded(targetUrl, "GET", controller.signal);
      } catch (getErr) {
        clearTimeout(timer);
        if (getErr?.name === "AbortError") {
          return jsonResponse({ ok: false, outcome: "timeout", status: 0 }, 200, cors);
        }
        const msg = String(getErr?.message || "");
        if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo") || msg.includes("dns")) {
          return jsonResponse({ ok: false, outcome: "dead", status: 0 }, 200, cors);
        }
        return jsonResponse({ ok: false, outcome: "error", status: 0 }, 200, cors);
      }
    }
    clearTimeout(timer);
    const status = response.status;
    if (status >= 200 && status < 400) {
      return jsonResponse({ ok: true, outcome: "alive", status }, 200, cors);
    }
    if ([404, 410].includes(status)) {
      return jsonResponse({ ok: false, outcome: "dead", status }, 200, cors);
    }
    return jsonResponse({ ok: false, outcome: "error", status }, 200, cors);
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      return jsonResponse({ ok: false, outcome: "timeout", status: 0 }, 200, cors);
    }
    return jsonResponse({ ok: false, outcome: "error", status: 0 }, 200, cors);
  }
}

// functions/api/check-link.ts
function onRequestOptions(context) {
  return cfPreflightResponse(context.request);
}
async function onRequest(context) {
  return handleProbe(context.request, { requireOrigin: true });
}
export {
  onRequest,
  onRequestOptions
};
