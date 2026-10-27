/**
 * 站点主体与备案信息
 *
 * 合规要求（缺一不可，都在网站可见位置）：
 *   1. **ICP 备案号**：必须展示，并链接到工信部备案系统 <https://beian.miit.gov.cn/>
 *      —— 《互联网信息服务管理办法》要求经营性/非经营性网站在首页标明备案编号。
 *   2. **公安联网备案号**：ICP 备案通过后须在 **30 日内**（自网络正式联通起）向属地公安
 *      网安部门办理（《计算机信息网络国际联网安全保护管理办法》第 12 条）。
 *      审核通过后由平台下发备案号与"网站标识码"，**必须展示并链接到公安备案平台**。
 *
 * 实现约定：**号为空则不渲染**（组件里做条件判断）。
 * 绝不能展示占位符或错误编号——错误的备案号比不展示更容易被判定为未履行义务。
 *
 * ⚠️ 修改此处时，同步改 `public/landing.js` 顶部的同名常量
 *    （落地页是独立静态脚本，不共享 src/ 代码）。
 */

/** ICP 备案号，例：'鄂ICP备2026000000号-1' */
export const ICP_NUMBER = ''

/** 公安联网备案号，例：'鄂公网安备42011302000000号' */
export const MPS_NUMBER = ''

/** 公安备案平台下发的「网站标识码」，用于拼查询链接（不是给人看的编号） */
export const MPS_CODE = ''

/** 工信部备案查询入口 */
export const MIIT_URL = 'https://beian.miit.gov.cn/'

/** 公安备案查询入口（带标识码时直接定位到本站记录） */
export function mpsQueryUrl(code = MPS_CODE): string {
  return code ? `https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(code)}` : 'https://beian.mps.gov.cn/'
}
