// 本文件由 scripts/build-fn-assets.mjs 从 supabase/functions/extract-video/video-adapters.ts 生成，请勿手改
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

// supabase/functions/extract-video/video-adapters.ts
var video_adapters_exports = {};
__export(video_adapters_exports, {
  detectPlatform: () => detectPlatform,
  isShortLinkHost: () => isShortLinkHost,
  isUrlDnsSafe: () => isUrlDnsSafe,
  parseBilibiliAiConclusion: () => parseBilibiliAiConclusion,
  parseBilibiliComments: () => parseBilibiliComments,
  parseBilibiliSubtitleDoc: () => parseBilibiliSubtitleDoc,
  parseBilibiliVideoId: () => parseBilibiliVideoId,
  parseBilibiliView: () => parseBilibiliView,
  parseYouTubeComments: () => parseYouTubeComments,
  parseYouTubeVideo: () => parseYouTubeVideo,
  parseYouTubeVideoId: () => parseYouTubeVideoId,
  validateInputUrl: () => validateInputUrl
});
module.exports = __toCommonJS(video_adapters_exports);

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
function isTargetDnsSafeSyncResults(hostname, records) {
  if (!records.length) return false;
  for (const r of records) {
    if (isPrivateHost(r)) return false;
  }
  return true;
}

// supabase/functions/extract-video/video-adapters.ts
var PRIVATE_LITERAL_HOSTS2 = /* @__PURE__ */ new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata"
]);
function isPrivateIPv4Literal(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || a === 0 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127 || a >= 224;
}
function validateInputUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL \u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL \u5FC5\u987B\u4EE5 http:// \u6216 https:// \u5F00\u5934");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL \u4E0D\u5F97\u5305\u542B\u8BA4\u8BC1\u4FE1\u606F");
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new Error("\u4EC5\u5141\u8BB8 80/443 \u7AEF\u53E3");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_LITERAL_HOSTS2.has(host) || isPrivateIPv4Literal(host) || host.includes(":")) {
    throw new Error("\u4E0D\u5141\u8BB8\u8BBF\u95EE\u5185\u7F51\u5730\u5740");
  }
  return parsed;
}
async function isUrlDnsSafe(parsed, resolver) {
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateHost(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  try {
    const records = [
      ...await resolver.resolve(host, "A"),
      ...await resolver.resolve(host, "AAAA")
    ];
    return isTargetDnsSafeSyncResults(host, records);
  } catch {
    return false;
  }
}
var SHORT_LINK_HOSTS = /* @__PURE__ */ new Set([
  "b23.tv",
  "bili2233.cn",
  "v.douyin.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "xhslink.com"
]);
function isShortLinkHost(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SHORT_LINK_HOSTS.has(host);
}
function parseBilibiliVideoId(u) {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "bilibili.com" && !host.endsWith(".bilibili.com")) return null;
  const m = /\/video\/(BV[0-9A-Za-z]+|av\d+)/i.exec(u.pathname);
  if (!m) return null;
  const id = m[1];
  return /^BV/i.test(id) ? { bvid: id } : { aid: id.replace(/^av/i, "") };
}
function parseYouTubeVideoId(u) {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg && /^[\w-]{6,}$/.test(seg) ? seg : null;
  }
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{6,}$/.test(v)) return v;
  const m = /^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1] : null;
}
function detectPlatform(u) {
  if (parseBilibiliVideoId(u)) return "bilibili";
  if (parseYouTubeVideoId(u)) return "youtube";
  return "generic";
}
function parseBilibiliView(json) {
  const data = json?.data;
  if (!data || typeof data !== "object") return null;
  const title = typeof data.title === "string" ? data.title : "";
  const desc = typeof data.desc === "string" ? data.desc : "";
  const aid = typeof data.aid === "number" ? data.aid : 0;
  const cid = typeof data.cid === "number" ? data.cid : Array.isArray(data.pages) && typeof data.pages[0]?.cid === "number" ? data.pages[0].cid : 0;
  const subtitleUrls = [];
  const subtitle = data.subtitle;
  if (Array.isArray(subtitle?.subtitles)) {
    for (const s of subtitle.subtitles) {
      const u = s?.subtitle_url;
      if (typeof u === "string" && u) {
        subtitleUrls.push(u.startsWith("//") ? `https:${u}` : u);
      }
    }
  }
  if (!title && !desc && !aid) return null;
  return { title, desc, aid, cid, subtitleUrls };
}
function parseBilibiliAiConclusion(json) {
  const data = json?.data;
  const model = data?.model_result;
  if (!model || typeof model !== "object") return "";
  const lines = [];
  if (typeof model.summary === "string" && model.summary.trim()) {
    lines.push(`\u3010\u89C6\u9891\u8BED\u97F3\u6838\u5FC3\u901F\u89C8\u3011
${model.summary.trim()}`);
  }
  if (Array.isArray(model.outline) && model.outline.length > 0) {
    lines.push("\u3010\u5185\u5BB9\u5206\u6BB5\u5927\u7EB2\u3011");
    for (const sec of model.outline) {
      if (sec?.title && typeof sec.title === "string" && sec.title.trim()) {
        lines.push(`### ${sec.title.trim()}`);
      }
      if (Array.isArray(sec?.part_outline)) {
        for (const p of sec.part_outline) {
          const timeSec = typeof p?.timestamp === "number" ? p.timestamp : 0;
          const min = Math.floor(timeSec / 60);
          const s = timeSec % 60;
          const timeStr = `${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          if (p?.content && typeof p.content === "string" && p.content.trim()) {
            lines.push(`- [${timeStr}] ${p.content.trim()}`);
          }
        }
      }
    }
  }
  return lines.join("\n");
}
function parseBilibiliComments(json) {
  const data = json?.data;
  const replies = Array.isArray(data?.replies) ? data.replies : [];
  const out = [];
  for (const r of replies) {
    const msg = r?.content?.message;
    if (typeof msg === "string" && msg.trim()) out.push(msg.trim());
    if (out.length >= 20) break;
  }
  return out;
}
function parseBilibiliSubtitleDoc(raw) {
  try {
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc.body)) return "";
    return doc.body.map((seg) => seg?.content || "").filter(Boolean).join("\n");
  } catch {
    return "";
  }
}
function parseYouTubeVideo(json) {
  const items = json?.items;
  const snippet = Array.isArray(items) && items.length ? items[0]?.snippet : void 0;
  if (!snippet) return null;
  return {
    title: typeof snippet.title === "string" ? snippet.title : "",
    description: typeof snippet.description === "string" ? snippet.description : ""
  };
}
function parseYouTubeComments(json) {
  const items = json?.items;
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    const text = it?.snippet?.topLevelComment?.snippet?.textDisplay;
    if (typeof text === "string" && text.trim()) out.push(text.trim());
    if (out.length >= 20) break;
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  detectPlatform,
  isShortLinkHost,
  isUrlDnsSafe,
  parseBilibiliAiConclusion,
  parseBilibiliComments,
  parseBilibiliSubtitleDoc,
  parseBilibiliVideoId,
  parseBilibiliView,
  parseYouTubeComments,
  parseYouTubeVideo,
  parseYouTubeVideoId,
  validateInputUrl
});
