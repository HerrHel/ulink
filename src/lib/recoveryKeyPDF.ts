/**
 * recoveryKeyPDF.ts — 生成 Recovery Key PDF 下载
 * 使用纯 HTML+print 打印为 PDF，无需第三方库
 */
export function generateRecoveryKeyPDF(recoveryKey: string) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>LinkVault Recovery Key</title>
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
  <h1>LinkVault Recovery Key</h1>
  <p class="subtitle">端到端加密恢复密钥</p>

  <div class="key-box">
    <div class="key-label">Recovery Key</div>
    <div class="key-value">${recoveryKey}</div>
  </div>

  <div class="warning">
    <h3>⚠️ 重要提醒</h3>
    <ul>
      <li>此 Recovery Key 是您恢复数据的<strong>唯一方式</strong></li>
      <li>忘记主密码且丢失此 Key 将导致数据<strong>永久丢失</strong></li>
      <li>请将此文件保存在安全的地方（如密码管理器、加密 U 盘）</li>
      <li>建议打印一份纸质副本存放在保险箱</li>
      <li><strong>不要</strong>将此文件存储在云端网盘或邮件中</li>
    </ul>
  </div>

  <div class="section">
    <h2>使用说明</h2>
    <p>
      <strong>忘记主密码时：</strong>在 LinkVault 的 E2E 解锁界面，点击"使用 Recovery Key"，
      输入此 Recovery Key 即可重新设置主密码并恢复数据访问。
    </p>
    <p style="margin-top:8px">
      <strong>换设备时：</strong>在新设备上安装 LinkVault，登录账户后，输入您的主密码即可解密数据。
      如果忘记主密码，使用此 Recovery Key 恢复。
    </p>
  </div>

  <div class="section">
    <h2>安全建议</h2>
    <p>
      • 主密码应足够复杂（建议 12 位以上，包含大小写字母、数字和符号）<br>
      • 不要与其他账户使用相同的密码<br>
      • 定期检查 Recovery Key 是否仍然可用<br>
      • 如果怀疑 Recovery Key 泄露，重新生成新的主密码和 Recovery Key
    </p>
  </div>

  <div class="footer">
    生成时间：${new Date().toLocaleString('zh-CN')} | LinkVault E2E Recovery Key
  </div>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) {
    win.onload = () => {
      win.print()
      URL.revokeObjectURL(url)
    }
  }
}
