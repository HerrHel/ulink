/**
 * recoveryKeyPDF.ts — 生成 Recovery Key 文件下载
 * 使用 <a download> 直接下载 HTML 文件，移动端和桌面端均可用
 * 双语：文案与品牌随当前 locale（与链 / ulink）。
 */
import { esc } from '../utils.js'
import { downloadFile, dateStamp } from './download.js'
import { t, getLocale } from '../i18n/index.js'

export function generateRecoveryKeyPDF(recoveryKey: string) {
  // 与全站 HTML 转义一致（含单引号），避免局部实现漂移
  const safeKey = esc(recoveryKey)
  const brand = t('app.brand')
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(t('recoveryKey.title'))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; max-width: 700px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .key-box { background: #f5f5f5; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center; }
  .key-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .key-value { font-family: 'Courier New', monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px; word-break: break-all; }
  .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 24px 0; }
  .warning h3 { color: #856404; font-size: 14px; margin-bottom: 8px; }
  .warning ul { margin-left: 20px; font-size: 13px; color: #856404; line-height: 1.8; }
  .section { margin: 24px 0; }
  .section h2 { font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
  .section p { font-size: 13px; line-height: 1.8; color: #444; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
</style>
</head>
<body>
  <h1>${esc(t('recoveryKey.title'))}</h1>
  <p class="subtitle">${esc(t('recoveryKey.subtitle'))}</p>

  <div class="key-box">
    <div class="key-label">Recovery Key</div>
    <div class="key-value">${safeKey}</div>
  </div>

  <div class="warning">
    <h3>${esc(t('recoveryKey.warningTitle'))}</h3>
    <ul>
      <li>${t('recoveryKey.warning1')}</li>
      <li>${t('recoveryKey.warning2')}</li>
      <li>${t('recoveryKey.warning3')}</li>
      <li>${t('recoveryKey.warning4')}</li>
      <li>${t('recoveryKey.warning5')}</li>
    </ul>
  </div>

  <div class="section">
    <h2>${esc(t('recoveryKey.usageTitle'))}</h2>
    <p>
      <strong>${esc(t('recoveryKey.forgotPwLabel'))}</strong>${t('recoveryKey.forgotPwBody')}
    </p>
    <p style="margin-top:8px;color:#856404">
      <strong>${esc(t('recoveryKey.noteLabel'))}</strong>${t('recoveryKey.noteBody')}
    </p>
    <p style="margin-top:8px">
      <strong>${esc(t('recoveryKey.newDeviceLabel'))}</strong>${t('recoveryKey.newDeviceBody')}
    </p>
  </div>

  <div class="section">
    <h2>${esc(t('recoveryKey.securityTitle'))}</h2>
    <p>
      ${t('recoveryKey.security1')}<br>
      ${t('recoveryKey.security2')}<br>
      ${t('recoveryKey.security3')}<br>
      ${t('recoveryKey.security4')}
    </p>
  </div>

  <div class="footer">
    ${t('recoveryKey.footer', { time: new Date().toLocaleString(getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false }), brand })}
  </div>
</body>
</html>`

  downloadFile(`ulink-Recovery-Key-${dateStamp()}.html`, html, 'text/html')
}
