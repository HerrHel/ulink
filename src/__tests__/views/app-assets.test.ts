/**
 * 主应用资源注入护栏（functions/_lib/app-assets.ts）。
 *
 * 背景：分享页 SSR 若注入不到主应用 bundle，页面就是纯静态的——用户看到旧布局，
 * 必须手动点 CTA 才进入 SPA。本测试锁定三条关键行为：
 *   1. ASSETS binding 可用时优先直读，成功即正缓存（同 isolate 不重复读）
 *   2. ASSETS 失败时回退同源自取
 *   3. **失败绝不写缓存**（否则一次瞬时失败会污染整个 isolate 生命周期）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const INDEX_HTML = `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" crossorigin href="/assets/index-AAA.css">
<script type="module" crossorigin src="/assets/index-BBB.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vue-vendor-CCC.js">
</head><body><div id="app"></div></body></html>`

/** 每个用例都重新加载模块，隔离模块级缓存。 */
async function loadModule() {
  vi.resetModules()
  return await import("../../functions/_lib/app-assets.js")
}

let warnSpy: ReturnType<typeof vi.spyOn>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  warnSpy.mockRestore()
  vi.unstubAllGlobals()
})

const okRes = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response
const failRes = { ok: false, status: 404, text: async () => "nope" } as unknown as Response

describe("getAppAssets — 主应用资源注入", () => {
  it("ASSETS binding 可用时直读 index.html 并提取 bundle 标签", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValue(okRes(INDEX_HTML))
    const env = { ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }

    const out = await getAppAssets(env, "https://ulink.ren/s/g1")

    expect(out).toContain("/assets/index-BBB.js")
    expect(out).toContain('type="module"')
    expect(out).toContain("/assets/index-AAA.css")
    expect(out).toContain("/assets/vue-vendor-CCC.js")
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    // 只提取同源相对路径资源，外链（谷歌字体等）不注入
    expect(out).not.toContain("fonts.googleapis.com")
  })

  it("ASSETS 传绝对路径（可被 new URL 解析）", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValue(okRes(INDEX_HTML))
    const env = { ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }

    await getAppAssets(env, "https://ulink.ren/s/c/cat_1")

    const arg = assetsFetch.mock.calls[0][0] as Request
    expect(arg.url).toBe("https://ulink.ren/index.html")
  })

  it("成功结果正缓存：第二次调用不再读 index.html", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValue(okRes(INDEX_HTML))
    const env = { ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }

    await getAppAssets(env, "https://ulink.ren/s/g1")
    await getAppAssets(env, "https://ulink.ren/s/g2")

    expect(assetsFetch).toHaveBeenCalledTimes(1)
  })

  it("ASSETS 不可用 → 回退同源自取", async () => {
    const { getAppAssets } = await loadModule()
    fetchMock.mockResolvedValue(okRes(INDEX_HTML))

    const out = await getAppAssets({ APP_ORIGIN: "https://ulink.ren" }, "https://ulink.ren/s/g1")

    expect(fetchMock).toHaveBeenCalledWith("https://ulink.ren/index.html")
    expect(out).toContain("/assets/index-BBB.js")
  })

  it("ASSETS 返回非 200 → 回退同源自取", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValue(failRes)
    fetchMock.mockResolvedValue(okRes(INDEX_HTML))

    const out = await getAppAssets({ ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }, "https://ulink.ren/s/g1")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out).toContain("/assets/index-BBB.js")
  })

  it("失败不写负缓存：首次失败后第二次调用仍会重试", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValueOnce(failRes).mockResolvedValueOnce(okRes(INDEX_HTML))
    fetchMock.mockResolvedValue(failRes)
    const env = { ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }

    const first = await getAppAssets(env, "https://ulink.ren/s/g1")
    const second = await getAppAssets(env, "https://ulink.ren/s/g1")

    expect(first).toBe("")
    expect(second).toContain("/assets/index-BBB.js")
    expect(assetsFetch).toHaveBeenCalledTimes(2)
  })

  it("全部策略失败 → 返回空串并告警（页面降级为静态骨架）", async () => {
    const { getAppAssets } = await loadModule()
    const assetsFetch = vi.fn().mockResolvedValue(failRes)
    fetchMock.mockResolvedValue(failRes)

    const out = await getAppAssets({ ASSETS: { fetch: assetsFetch }, APP_ORIGIN: "https://ulink.ren" }, "https://ulink.ren/s/g1")

    expect(out).toBe("")
    expect(warnSpy).toHaveBeenCalled()
  })
})
