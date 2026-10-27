/**
 * 购买 / 支付相关文案（zh + en）
 *
 * 单独成文件的原因：支付文案与合规口径强相关（价格、退款、开票），
 * 集中放置便于法务与运营一起 review，也避免和 modals.ts 混在一起。
 *
 * ⚠️ 文案里**不写具体价格**（价格来自服务端 plans 表，写死会与实际不符）。
 * ⚠️ 错误文案必须覆盖 `usePayment` 里 PaymentError 的全部枚举，否则界面会露 key。
 */

export const purchaseZh = {
  purchase: {
    title: '升级套餐',
    subtitle: '解锁更高额度与更多能力，随时可取消',
    noPlans: '暂无可购买的套餐',
    payNow: '立即支付',
    upgrade: '升级套餐',
    renew: '续费',
    creating: '正在创建订单…',
    qrAlt: '支付二维码',
    notOpen: '该支付方式暂未开通，开通后即可在此完成支付。',
    countdown: '二维码 {time} 后失效',
    expired: '二维码已失效，请重新创建订单',
    recreate: '重新创建',
    successTitle: '支付成功',
    successDesc: '权益已到账，返回设置即可查看当前方案。',
    channel: {
      wechat: '微信支付',
      alipay: '支付宝',
    },
    scan: {
      wechat: '请用微信扫描二维码完成支付',
      alipay: '请用支付宝扫描二维码完成支付',
    },
    error: {
      not_configured: '支付服务暂未配置，请稍后再试。',
      channel_not_configured: '该支付方式暂未开通。',
      unauthorized: '请先登录后再购买。',
      rate_limited: '操作过于频繁，请稍后再试。',
      plan_not_payable: '该套餐无需支付。',
      plan_not_found: '套餐不存在或已下架。',
      order_not_found: '订单不存在或已失效。',
      channel_error: '支付渠道异常，请稍后重试。',
      network: '网络异常，请检查网络后重试。',
      unknown: '支付失败，请稍后重试。',
    },
  },
} as const

export const purchaseEn = {
  purchase: {
    title: 'Upgrade plan',
    subtitle: 'More quota and capabilities. Cancel anytime.',
    noPlans: 'No plans available',
    payNow: 'Pay now',
    upgrade: 'Upgrade',
    renew: 'Renew',
    creating: 'Creating order…',
    qrAlt: 'Payment QR code',
    notOpen: 'This payment method is not enabled yet. It will be available here once activated.',
    countdown: 'QR code expires in {time}',
    expired: 'QR code expired. Please create a new order.',
    recreate: 'Create new order',
    successTitle: 'Payment successful',
    successDesc: 'Your plan is active. Go back to settings to see the current plan.',
    channel: {
      wechat: 'WeChat Pay',
      alipay: 'Alipay',
    },
    scan: {
      wechat: 'Scan the QR code with WeChat to pay',
      alipay: 'Scan the QR code with Alipay to pay',
    },
    error: {
      not_configured: 'Payment service is not configured yet.',
      channel_not_configured: 'This payment method is not enabled yet.',
      unauthorized: 'Please sign in before purchasing.',
      rate_limited: 'Too many attempts. Please try again later.',
      plan_not_payable: 'This plan does not require payment.',
      plan_not_found: 'Plan not found or no longer available.',
      order_not_found: 'Order not found or expired.',
      channel_error: 'Payment channel error. Please try again later.',
      network: 'Network error. Please check your connection and retry.',
      unknown: 'Payment failed. Please try again later.',
    },
  },
} as const
