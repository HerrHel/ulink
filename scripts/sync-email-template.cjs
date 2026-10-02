/**
 * sync-email-template.cjs
 * 将 supabase/email-templates/otp-login.html 同步至 Supabase 云端 Auth 邮件模板 (Magic Link OTP)
 * 用法: npm run email:sync
 */
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
if (!fs.existsSync(envPath)) {
  console.error('❌ 未找到 .env 文件')
  process.exit(1)
}

const envContent = fs.readFileSync(envPath, 'utf8')
const tokenMatch = envContent.match(/SUPABASE_ACCESS_TOKEN=(.+)/)
if (!tokenMatch) {
  console.error('❌ .env 中未配置 SUPABASE_ACCESS_TOKEN')
  process.exit(1)
}

const SUPABASE_ACCESS_TOKEN = tokenMatch[1].trim()
const PROJECT_REF = 'yqouglfopbmujkqmjgpu'
const templatePath = path.join(__dirname, '..', 'supabase', 'email-templates', 'otp-login.html')

if (!fs.existsSync(templatePath)) {
  console.error(`❌ 未找到邮件模板文件: ${templatePath}`)
  process.exit(1)
}

const htmlContent = fs.readFileSync(templatePath, 'utf8')

async function syncEmailTemplate() {
  console.log(`🚀 正在推送邮件模板至 Supabase 项目: ${PROJECT_REF}...`)
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mailer_templates_magic_link_content: htmlContent,
      }),
    })

    if (res.ok) {
      console.log('✅ 邮件模板已成功同步至 Supabase 云端！')
    } else {
      const err = await res.text()
      console.error(`❌ 同步失败 (${res.status}): ${err}`)
      process.exit(1)
    }
  } catch (err) {
    console.error('❌ 请求发生异常:', err)
    process.exit(1)
  }
}

syncEmailTemplate()
