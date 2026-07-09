// deploy.ts — Self-contained Deno.serve() Edge Function (no esm.sh deps)
// S7 SSRF guard + S9 CORS fail-closed. ASCII-only to avoid encoding issues in
// Supabase Management API deployment.

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "";
const ALLOWED_ORIGIN_LIST = ALLOWED_ORIGINS
  ? ALLOWED_ORIGINS.split(",").filter(Boolean)
  : [];
const PRIVATE_LITERALS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata",
]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

// ---- SSRF: IPv4 private/loopback/link-local detection ----

function isIPv4Private(octets) {
  if (
    octets.length !== 4 ||
    octets.some(function (o) { return o < 0 || o > 255; })
  )
    return false;
  var a = octets[0], b = octets[1];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 0) return true; // this network
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF reserved
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast / reserved
  return false;
}

// ---- SSRF: IPv6 private/link-local/mapped detection ----

function isIPv6Private(hextets) {
  if (hextets.length !== 8) return false;
  var a = hextets[0], b = hextets[1];
  if (
    hextets.slice(0, 7).every(function (h) { return h === 0; }) &&
    hextets[7] === 1
  )
    return true; // ::1 loopback
  if (hextets.every(function (h) { return h === 0; })) return true; // ::
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (a === 0x2001 && b === 0x0db8) return true; // 2001:db8::/32 docs
  // IPv4-mapped ::ffff:a.b.c.d
  if (
    hextets.slice(0, 5).every(function (h) { return h === 0; }) &&
    hextets[5] === 0xffff
  ) {
    var ipv4 = [
      (hextets[6] >> 8) & 0xff,
      hextets[6] & 0xff,
      (hextets[7] >> 8) & 0xff,
      hextets[7] & 0xff,
    ];
    return isIPv4Private(ipv4);
  }
  // IPv4-compatible ::a.b.c.d (deprecated, still catch)
  if (
    hextets.slice(0, 5).every(function (h) { return h === 0; }) &&
    hextets[5] === 0
  ) {
    var ipv4c = [
      (hextets[6] >> 8) & 0xff,
      hextets[6] & 0xff,
      (hextets[7] >> 8) & 0xff,
      hextets[7] & 0xff,
    ];
    return isIPv4Private(ipv4c);
  }
  return false;
}

// ---- SSRF: hostname parser (dotted-decimal, decimal int, hex/oct int) ----

function parseIPv4Host(hostname) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (m) {
    var octets = m.slice(1).map(Number);
    if (octets.some(function (o) { return isNaN(o) || o > 255; })) return null;
    return octets;
  }
  var mm = /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.exec(hostname);
  if (mm) {
    var isHex = /^0x/i.test(hostname);
    var isOct = /^0[0-7]+$/i.test(hostname);
    var n = parseInt(hostname, isHex ? 16 : isOct ? 8 : 10);
    if (isNaN(n) || n < 0 || n > 0xffffffff) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ];
  }
  return null;
}

function parseIPv6Host(h) {
  var low = h.toLowerCase();
  if (low.startsWith("[") && low.endsWith("]")) low = low.slice(1, -1);
  if (!low.includes(":")) return null;
  var parts = low.split("::");
  if (parts.length > 2) return null;

  function expandDotted(segs) {
    if (segs.length === 0) return segs;
    var last = segs[segs.length - 1];
    if (last.includes(".")) {
      var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(last);
      if (!m) return null;
      var o = m.slice(1).map(Number);
      if (o.some(function (v) { return isNaN(v) || v > 255; })) return null;
      return [
        ...segs.slice(0, -1),
        ((o[0] << 8) | o[1]).toString(16),
        ((o[2] << 8) | o[3]).toString(16),
      ];
    }
    return segs;
  }

  var left, right, fill;
  if (parts.length === 2) {
    left = parts[0] ? parts[0].split(":") : [];
    right = parts[1] ? parts[1].split(":") : [];
    left = expandDotted(left);
    right = expandDotted(right);
    if (left === null || right === null) return null;
    fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    low = [...left, ...Array(fill).fill("0"), ...right].join(":");
  } else {
    var segs = expandDotted(parts[0].split(":"));
    if (segs === null) return null;
    low = segs.join(":");
  }
  var finalSegs = low.split(":");
  if (finalSegs.length !== 8) return null;
  var hextets = finalSegs.map(function (s) {
    var v = parseInt(s, 16);
    return isNaN(v) || v < 0 || v > 0xffff ? null : v;
  });
  if (hextets.some(function (x) { return x === null; })) return null;
  return hextets;
}

function isPrivateHost(name) {
  var low = name.toLowerCase();
  if (low.startsWith("[") && low.endsWith("]")) low = low.slice(1, -1);
  if (PRIVATE_LITERALS.has(low)) return true;
  var v4 = parseIPv4Host(low);
  if (v4) return isIPv4Private(v4);
  var v6 = parseIPv6Host(low);
  if (v6) return isIPv6Private(v6);
  return false;
}

// ---- SSRF: validate URL against whitelist + private-host check ----

function validateUrl(raw) {
  var p;
  try {
    p = new URL(raw);
  } catch (_e) {
    throw new Error("Invalid URL");
  }
  if (!ALLOWED_PROTOCOLS.has(p.protocol))
    throw new Error("Only http/https allowed");
  if (p.username || p.password) throw new Error("Credentials not allowed");
  if (!ALLOWED_PORTS.has(p.port)) throw new Error("Only port 80/443 allowed");
  if (isPrivateHost(p.hostname)) throw new Error("Private IP blocked");
  return p;
}

// ---- S9: CORS fail-closed ----

function isOriginAllowed(origin, allowed) {
  if (!origin || allowed.length === 0) return false;
  return allowed.includes(origin);
}

function corsHeaders(origin) {
  var h = {};
  if (isOriginAllowed(origin, ALLOWED_ORIGIN_LIST)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
  }
  h["Vary"] = "Origin";
  return h;
}

// ---- S7: Redirect hop-by-hop fetch with per-hop SSRF validation ----

async function fetchWithRedirect(url, method, timeoutMs) {
  var cur = url;
  var curMethod = method;
  var lastResp = null;
  for (var hop = 0; hop <= MAX_REDIRECTS; hop++) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    try {
      lastResp = await fetch(cur.href, {
        method: curMethod,
        signal: ctrl.signal,
        headers: { "User-Agent": "LinkVault/1.0 CheckLink" },
      });
    } finally {
      clearTimeout(t);
    }
    if (lastResp.status >= 300 && lastResp.status < 400) {
      var loc = lastResp.headers.get("Location");
      if (!loc || hop === MAX_REDIRECTS) return lastResp;
      var nu = new URL(loc, cur.href);
      try {
        cur = validateUrl(nu.href);
      } catch (_e) {
        throw new Error("Redirect blocked");
      }
      if ([301, 302, 303].includes(lastResp.status)) curMethod = "GET";
      continue;
    }
    return lastResp;
  }
  return lastResp;
}

// ---- Main handler ----

Deno.serve(async function (req) {
  var origin = req.headers.get("Origin");
  var cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: isOriginAllowed(origin, ALLOWED_ORIGIN_LIST) ? 200 : 403,
      headers: cors,
    });
  }

  try {
    var auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: Object.assign({}, cors, { "Content-Type": "application/json" }),
      });
    }

    var body = await req.json();
    var url = body.url, bookmark_id = body.bookmark_id;
    if (!url || !url.startsWith("http")) {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: Object.assign({}, cors, { "Content-Type": "application/json" }),
      });
    }

    var parsedUrl;
    try {
      parsedUrl = validateUrl(url);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Invalid URL: " + (e && e.message || "blocked") }),
        { status: 400, headers: Object.assign({}, cors, { "Content-Type": "application/json" }) }
      );
    }

    var st = Date.now();
    var status = "unknown";
    var http_status = 0;
    var details = {};

    try {
      var resp = await fetchWithRedirect(parsedUrl, "HEAD", DEFAULT_TIMEOUT_MS);
      if (resp.status === 405)
        resp = await fetchWithRedirect(parsedUrl, "GET", DEFAULT_TIMEOUT_MS);
      http_status = resp.status;
      var rt = Date.now() - st;
      status =
        resp.status >= 200 && resp.status < 400
          ? "alive"
          : resp.status >= 400
          ? "dead"
          : "unknown";
      details = { response_time: rt, final_url: resp.url };
    } catch (e) {
      var rt = Date.now() - st;
      if (
        (e && e.name === "AbortError") ||
        (e && e.message && e.message.includes("abort"))
      ) {
        status = "blocked";
        details = { response_time: rt, error: "timeout" };
      } else if (
        (e && e.message === "Redirect blocked") ||
        (e && e.message && e.message.includes("Private")) ||
        (e && e.message && e.message.includes("blocked"))
      ) {
        status = "blocked";
        details = { response_time: rt, error: "blocked by security policy" };
      } else {
        status = "dead";
        details = { response_time: rt, error: "request failed" };
      }
    }

    return new Response(JSON.stringify({ status: status, http_status: http_status, details: details }), {
      headers: Object.assign({}, cors, { "Content-Type": "application/json" }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: Object.assign({}, cors, { "Content-Type": "application/json" }),
    });
  }
});
