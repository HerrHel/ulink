// 本文件由 scripts/build-fn-assets.mjs 从 functions/api/ai-candidates.ts 生成，请勿手改
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

// functions/api/ai-candidates.ts
var ai_candidates_exports = {};
__export(ai_candidates_exports, {
  onRequestOptions: () => onRequestOptions,
  onRequestPost: () => onRequestPost
});
module.exports = __toCommonJS(ai_candidates_exports);

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

// functions/api/ai-candidates.ts
var MAX_QUERY_LEN = 2e3;
var CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
function sanitizeForPrompt(value) {
  return String(value ?? "").replace(CTRL_RE, " ").replace(/`/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LEN);
}
var onRequestOptions = async (context) => {
  return cfPreflightResponse(context.request);
};
var onRequestPost = async (context) => {
  const { request } = context;
  const guard = await guardCfRequest(request, { requireAuth: true });
  if (guard) return guard;
  const cors = cfCorsHeaders(request) ?? {};
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors
    }
  });
  try {
    const body = await context.request.json().catch(() => ({}));
    const { type, query, targetUrl, targetTitle } = body;
    if (type !== "similar" && type !== "intent") {
      return jsonResponse({ success: false, error: "invalid_type" }, 400);
    }
    const mimoKey = context.env.MIMO_API_KEY || "";
    if (!mimoKey) {
      return jsonResponse({ success: false, error: "mimo_key_not_configured" }, 503);
    }
    let prompt = "";
    if (type === "similar") {
      const safeTitle = sanitizeForPrompt(targetTitle);
      const safeUrl = sanitizeForPrompt(targetUrl);
      const site = safeTitle ? `${safeTitle} (${safeUrl || ""})` : safeUrl || "\u8BE5\u7F51\u7AD9";
      prompt = `\u4F60\u662F\u4E00\u4E2A\u8D44\u6DF1\u4E92\u8054\u7F51\u5DE5\u5177\u4E0E\u9AD8\u4EF7\u503C\u8F6F\u4EF6\u6316\u6398\u4E13\u5BB6\u3002
\u7528\u6237\u6B63\u5728\u5BFB\u627E\u4E0E\u7F51\u7AD9\u3010${site}\u3011\u529F\u80FD\u76F8\u8FD1\u3001\u5B9A\u4F4D\u76F8\u4F3C\u7684\u4F18\u79C0\u540C\u7C7B\u5E73\u53F0\u3001\u4F18\u8D28\u7ADE\u54C1\u6216\u5F00\u6E90\u5E73\u66FF\u5DE5\u5177\u3002

\u8BF7\u63A8\u8350 3-5 \u4E2A\u771F\u5B9E\u5B58\u5728\u3001\u5F53\u524D\u77E5\u540D\u4E14\u6B63\u5E38\u8FD0\u884C\u7684\u9876\u7EA7\u516C\u7F51\u7F51\u7AD9\u3002
\u8981\u6C42\uFF1A
1. \u7F51\u7AD9\u7F51\u5740\u5FC5\u987B\u771F\u5B9E\u6709\u6548\uFF08\u5982\u5B98\u65B9\u9996\u9875\u5730\u5740\uFF09\uFF0C\u4E25\u7981\u634F\u9020\u6216\u62FC\u63A5\u4E0D\u5B58\u5728\u7684\u7F51\u5740\u3002
2. \u5305\u542B\u9AD8\u8D28\u91CF\u540C\u7C7B\u5DE5\u5177\u3001\u5F00\u6E90\u5E73\u66FF\u3001\u8F7B\u91CF\u7EA7\u66FF\u4EE3\u6216\u56FD\u5185\u76F4\u8FDE\u4EA7\u54C1\u3002
3. \u4E25\u7981\u5305\u542B\u4EFB\u4F55 Emoji \u8868\u60C5\u7B26\u53F7\u3002
4. \u8F93\u51FA\u5408\u6CD5\u7684 JSON \u6570\u7EC4\uFF0C\u683C\u5F0F\u5982\u4E0B\uFF1A
[
  {
    "title": "\u5DE5\u5177\u540D\u79F0",
    "url": "https://...",
    "notes": "20-50\u5B57\u6838\u5FC3\u529F\u80FD\u4E0E\u7279\u8272\u8BF4\u660E",
    "tag": "\u5F00\u6E90\u514D\u8D39/\u8F7B\u91CF\u6613\u7528/\u4E13\u4E1A\u9996\u9009/\u56FD\u5185\u76F4\u8FDE \u7B49\u7B80\u77ED\u6807\u7B7E",
    "highlight": "\u4E00\u53E5\u8BDD\u63A8\u8350\u7406\u7531"
  }
]
\u76F4\u63A5\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55 Markdown \u6807\u8BB0\u6216\u591A\u4F59\u6587\u5B57\u3002`;
    } else {
      const q = sanitizeForPrompt(query);
      if (!q) {
        return jsonResponse({ success: false, error: "empty_query" }, 400);
      }
      prompt = `\u4F60\u662F\u4E00\u4E2A\u8D44\u6DF1\u4E92\u8054\u7F51\u5DE5\u5177\u4E0E\u9AD8\u4EF7\u503C\u8F6F\u4EF6\u6316\u6398\u4E13\u5BB6\u3002
\u7528\u6237\u6B63\u5728\u5BFB\u627E\u6EE1\u8DB3\u7279\u5B9A\u9700\u6C42\u7684\u771F\u5B9E\u4F18\u8D28\u7F51\u7AD9\u6216\u5728\u7EBF\u5DE5\u5177\u3002
\u7528\u6237\u9700\u6C42/\u610F\u56FE\uFF1A"${q}"

\u8BF7\u63A8\u8350 3-5 \u4E2A\u771F\u5B9E\u5B58\u5728\u3001\u5F53\u524D\u77E5\u540D\u4E14\u6B63\u5E38\u8FD0\u884C\u7684\u9876\u7EA7\u516C\u7F51\u7F51\u7AD9\u3002
\u8981\u6C42\uFF1A
1. \u7F51\u7AD9\u7F51\u5740\u5FC5\u987B\u771F\u5B9E\u6709\u6548\uFF08\u5982\u5B98\u65B9\u9996\u9875\u5730\u5740\uFF09\uFF0C\u4E25\u7981\u634F\u9020\u6216\u80E1\u4E71\u62FC\u63A5\u4E0D\u5B58\u5728\u7684\u7F51\u5740\u3002
2. \u9488\u5BF9\u7528\u6237\u5177\u4F53\u610F\u56FE\uFF0C\u7CBE\u51C6\u7ED9\u51FA\u5177\u6709\u4EE3\u8868\u6027\u7684\u5B9E\u7528\u5DE5\u5177\u3002
3. \u4E25\u7981\u5305\u542B\u4EFB\u4F55 Emoji \u8868\u60C5\u7B26\u53F7\u3002
4. \u8F93\u51FA\u5408\u6CD5\u7684 JSON \u6570\u7EC4\uFF0C\u683C\u5F0F\u5982\u4E0B\uFF1A
[
  {
    "title": "\u5DE5\u5177\u540D\u79F0",
    "url": "https://...",
    "notes": "20-50\u5B57\u6838\u5FC3\u529F\u80FD\u4E0E\u7279\u8272\u8BF4\u660E",
    "tag": "\u5F00\u6E90\u514D\u8D39/\u8F7B\u91CF\u6613\u7528/\u4E13\u4E1A\u9996\u9009/\u56FD\u5185\u76F4\u8FDE \u7B49\u7B80\u77ED\u6807\u7B7E",
    "highlight": "\u4E00\u53E5\u8BDD\u63A8\u8350\u7406\u7531"
  }
]
\u76F4\u63A5\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55 Markdown \u6807\u8BB0\u6216\u591A\u4F59\u6587\u5B57\u3002`;
    }
    const mimoRes = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mimoKey}`
      },
      body: JSON.stringify({
        model: "mimo-v2.6-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1e3
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!mimoRes.ok) {
      return jsonResponse({ success: false, error: "upstream_failed" }, 502);
    }
    const mData = await mimoRes.json();
    const mRaw = mData.choices?.[0]?.message?.content?.trim() || "";
    const mJson = mRaw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const items = JSON.parse(mJson);
    if (Array.isArray(items) && items.length > 0) {
      const validItems = items.filter(
        (it) => it && typeof it.title === "string" && typeof it.url === "string" && it.url.startsWith("http")
      );
      return jsonResponse({ success: true, items: validItems });
    }
    return jsonResponse({ success: false, error: "empty_result" });
  } catch {
    return jsonResponse({ success: false, error: "internal_error" }, 500);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  onRequestOptions,
  onRequestPost
});
