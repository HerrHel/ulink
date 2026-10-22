// 本文件由 scripts/build-fn-assets.mjs 从 supabase/functions/mimo-chat/mimo-guard.ts 生成，请勿手改
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

// supabase/functions/mimo-chat/mimo-guard.ts
var mimo_guard_exports = {};
__export(mimo_guard_exports, {
  MAX_MESSAGES_DEFAULT: () => MAX_MESSAGES_DEFAULT,
  MAX_MESSAGE_CHARS_DEFAULT: () => MAX_MESSAGE_CHARS_DEFAULT,
  MAX_TOOLS_CHARS_DEFAULT: () => MAX_TOOLS_CHARS_DEFAULT,
  MAX_TOTAL_CHARS_DEFAULT: () => MAX_TOTAL_CHARS_DEFAULT,
  buildCorsHeaders: () => buildCorsHeaders,
  isOriginAllowed: () => isOriginAllowed,
  textLength: () => textLength,
  validateChatBody: () => validateChatBody
});
module.exports = __toCommonJS(mimo_guard_exports);
var MAX_MESSAGES_DEFAULT = 40;
var MAX_MESSAGE_CHARS_DEFAULT = 4e3;
var MAX_TOTAL_CHARS_DEFAULT = 12e4;
var MAX_TOOLS_CHARS_DEFAULT = 3e4;
var ALLOWED_ROLES = /* @__PURE__ */ new Set(["system", "user", "assistant", "tool"]);
var ALLOWED_TOOL_CHOICES = /* @__PURE__ */ new Set(["auto", "none", "required"]);
var MODEL_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;
function textLength(value) {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((n, item) => n + textLength(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((n, item) => n + textLength(item), 0);
  }
  return 0;
}
function validateChatBody(body, opts) {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES_DEFAULT;
  const maxMessageChars = opts.maxMessageChars ?? MAX_MESSAGE_CHARS_DEFAULT;
  const maxTotalChars = opts.maxTotalChars ?? MAX_TOTAL_CHARS_DEFAULT;
  const maxToolsChars = opts.maxToolsChars ?? MAX_TOOLS_CHARS_DEFAULT;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid request body" };
  }
  const b = body;
  const allowed = /* @__PURE__ */ new Set([opts.defaultModel, ...opts.allowedModels]);
  let model = opts.defaultModel;
  if (b.model !== void 0) {
    if (typeof b.model !== "string" || !MODEL_NAME_RE.test(b.model) || !allowed.has(b.model)) {
      return { ok: false, status: 400, error: "Model not allowed" };
    }
    model = b.model;
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, status: 400, error: "messages must be a non-empty array" };
  }
  if (b.messages.length > maxMessages) {
    return { ok: false, status: 413, error: `Too many messages (max ${maxMessages})` };
  }
  let totalChars = 0;
  for (const raw of b.messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, status: 400, error: "Invalid message entry" };
    }
    const m = raw;
    if (typeof m.role !== "string" || !ALLOWED_ROLES.has(m.role)) {
      return { ok: false, status: 400, error: "Invalid message role" };
    }
    const size = textLength(m);
    if (size > maxMessageChars) {
      return { ok: false, status: 413, error: `Message too large (max ${maxMessageChars} chars)` };
    }
    totalChars += size;
    if (totalChars > maxTotalChars) {
      return { ok: false, status: 413, error: `Conversation too large (max ${maxTotalChars} chars)` };
    }
  }
  const payload = {
    model,
    messages: b.messages,
    stream: b.stream !== false
  };
  if (typeof b.temperature === "number" && Number.isFinite(b.temperature)) {
    payload.temperature = Math.min(2, Math.max(0, b.temperature));
  }
  if (b.tools !== void 0) {
    if (!Array.isArray(b.tools)) {
      return { ok: false, status: 400, error: "tools must be an array" };
    }
    const toolsChars = textLength(b.tools);
    if (toolsChars > maxToolsChars) {
      return { ok: false, status: 413, error: `Tools too large (max ${maxToolsChars} chars)` };
    }
    payload.tools = b.tools;
  }
  if (b.tool_choice !== void 0) {
    if (typeof b.tool_choice !== "string" || !ALLOWED_TOOL_CHOICES.has(b.tool_choice)) {
      return { ok: false, status: 400, error: "Invalid tool_choice" };
    }
    payload.tool_choice = b.tool_choice;
  }
  return { ok: true, value: payload };
}
function isOriginAllowed(origin, allowed) {
  if (!origin) return true;
  return allowed.length > 0 && allowed.includes(origin);
}
function buildCorsHeaders(origin, allowed) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (isOriginAllowed(origin, allowed) && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_MESSAGES_DEFAULT,
  MAX_MESSAGE_CHARS_DEFAULT,
  MAX_TOOLS_CHARS_DEFAULT,
  MAX_TOTAL_CHARS_DEFAULT,
  buildCorsHeaders,
  isOriginAllowed,
  textLength,
  validateChatBody
});
