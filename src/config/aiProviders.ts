/**
 * AI 服务商清单 —— 支撑《隐私政策》§3.3 的接收方告知义务
 *
 * 为什么法律文档里写「境内第三方大模型服务商」而这里写真实名称：
 * 《个人信息保护法》第二十三条要求告知**接收方的名称和联系方式**。
 * 法律文档用概括表述以保留更换模型的弹性，但**产品内必须显示当前实际使用的服务商**，
 * 否则该条告知没有对应入口，等于没有履行。
 *
 * 两者不矛盾：法律文档说明「名单见产品内」，本文件就是那个名单的来源。
 * 更换模型服务商时，**只需改这里**（并同步更新隐私政策 §3.3 与本文件的时间戳）。
 */

export interface AiProviderInfo {
  /** 稳定标识，供埋点与多服务商切换时使用 */
  id: string
  /** 服务商法定名称（对外披露用） */
  name: string
  /** 具体模型/产品名称 */
  product: string
  /** 官方站点 */
  website: string
  /** 服务商联系方式（PIPL 23 条要求的接收方联系方式） */
  contact: string
  /** 备案与数据处理说明 */
  filing: string
}

/**
 * 当前实际使用的 AI 服务商。
 * ⚠️ 本列表会展示给用户，构成《隐私政策》§3.3 的告知内容，请勿填入未实际使用的服务商。
 */
export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'mimo',
    name: '小米 MiMo',
    product: 'MiMo 大模型（mimo-v2.6-flash）',
    website: 'https://xiaomimimo.com',
    contact: 'herr@ulink.ren（与链接口人，可转达服务商）',
    filing: '境内服务商，已依法完成生成式人工智能服务备案',
  },
  // 以下为《隐私政策》§3.1 / §3.3 所列的实际接收方 / 处理方（非大模型服务商）。
  // product 字段描述服务本身，不写具体模型名称，与对外合规口径一致。
  {
    id: 'jina-reader',
    name: 'Jina Reader（r.jina.ai）',
    product: '网页正文读取服务',
    website: 'https://jina.ai',
    contact: 'herr@ulink.ren（与链接口人，可转达服务商）',
    filing: '境外服务；当网页标题/描述抓取失败或平台接口降级时，将待读取网页 URL 提交该服务以读取公开页面正文，相关处理亦可能经境外边缘节点发起',
  },
  {
    id: 'cloudflare-pages',
    name: 'Cloudflare, Inc.（Cloudflare Pages / Workers）',
    product: '边缘函数托管与内容分发',
    website: 'https://www.cloudflare.com',
    contact: 'herr@ulink.ren（与链接口人，可转达服务商）',
    filing: '境外边缘节点；承载意图寻站、网页元数据提取与海外死链探测，处理网页 URL、页面公开元数据及部分提示词内容，相关模型调用由该节点发起至境内第三方大模型服务商',
  },
  {
    id: 'youtube-data-api',
    name: 'Google LLC（YouTube Data API）',
    product: '公开视频元数据接口',
    website: 'https://developers.google.com/youtube/v3',
    contact: 'herr@ulink.ren（与链接口人，可转达服务商）',
    filing: '境外服务；仅在视频解析功能启用时读取公开视频元数据（标题、简介、字幕、公开评论）',
  },
  {
    id: 'favicon-xinac',
    name: 'api.xinac.net（站点图标服务）',
    product: '网站图标（favicon）获取服务',
    website: 'https://api.xinac.net',
    contact: 'herr@ulink.ren（与链接口人，可转达服务商）',
    filing: '第三方服务；按待添加书签的域名请求站点图标，处理书签域名 / URL；运营主体以该服务方官网公示为准',
  },
]

/** 清单最后更新时间——展示在设置页，便于用户判断信息是否新鲜 */
export const AI_PROVIDERS_UPDATED_AT = '2026-11-07'

/**
 * 隐私政策与用户协议中引用的《隐私政策》地址（产品内可直接访问）
 *
 * 指向**渲染后的 HTML 页面**（`legalDocsPlugin` 在构建期由 docs/legal/*.md 生成）。
 * 显式带 `.html` 后缀：不依赖静态托管的 pretty URL 规则，任何环境都能打开。
 */
export const LEGAL_DOC_LINKS = [
  { key: 'terms', path: '/legal/terms-of-service.html', labelKey: 'settings.legalTerms' },
  { key: 'privacy', path: '/legal/privacy-policy.html', labelKey: 'settings.legalPrivacy' },
  { key: 'refund', path: '/legal/refund-policy.html', labelKey: 'settings.legalRefund' },
] as const
