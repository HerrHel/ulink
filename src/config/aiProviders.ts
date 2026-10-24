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
    filing: '境内服务商，已依法完成生成式人工智能服务备案',
  },
]

/** 清单最后更新时间——展示在设置页，便于用户判断信息是否新鲜 */
export const AI_PROVIDERS_UPDATED_AT = '2026-10-25'

/** 隐私政策与用户协议中引用的《隐私政策》地址（产品内可直接访问） */
export const LEGAL_DOC_LINKS = [
  { key: 'terms', path: '/legal/terms-of-service.md', labelKey: 'settings.legalTerms' },
  { key: 'privacy', path: '/legal/privacy-policy.md', labelKey: 'settings.legalPrivacy' },
  { key: 'refund', path: '/legal/refund-policy.md', labelKey: 'settings.legalRefund' },
] as const
