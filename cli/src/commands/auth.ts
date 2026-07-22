/**
 * auth 命令 - 认证管理
 */
import { Command } from 'commander'
import * as auth from '../lib/auth.js'
import * as format from '../lib/format.js'
import { resetClient } from '../lib/supabase.js'

export function registerAuthCommand(program: Command): void {
  const authCmd = program
    .command('auth')
    .description('认证管理')

  authCmd
    .command('login')
    .description('登录（Email OTP）')
    .argument('<email>', '邮箱地址')
    .action(async (email: string) => {
      try {
        format.info(`正在发送验证码到 ${email}...`)
        await auth.sendOtp(email)
        format.success('验证码已发送，请检查邮箱')

        // 等待用户输入验证码
        const readline = await import('readline')
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        })

        const token = await new Promise<string>((resolve) => {
          rl.question('请输入验证码: ', (answer) => {
            rl.close()
            resolve(answer.trim())
          })
        })

        if (!token) {
          format.error('验证码不能为空')
          process.exit(1)
        }

        format.info('正在验证...')
        const { userId } = await auth.verifyOtp(email, token)
        resetClient() // 重置客户端以使用新 token
        format.success(`登录成功！用户 ID: ${userId}`)
      } catch (err) {
        format.error(`登录失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  authCmd
    .command('verify')
    .description('验证 OTP 验证码（非交互式）')
    .argument('<email>', '邮箱地址')
    .argument('<token>', '验证码')
    .action(async (email: string, token: string) => {
      try {
        format.info('正在验证...')
        const { userId } = await auth.verifyOtp(email, token)
        resetClient()
        format.success(`登录成功！用户 ID: ${userId}`)
      } catch (err) {
        format.error(`验证失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  authCmd
    .command('logout')
    .description('登出')
    .action(async () => {
      try {
        await auth.signOut()
        resetClient()
        format.success('已登出')
      } catch (err) {
        format.error(`登出失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  authCmd
    .command('whoami')
    .description('显示当前用户')
    .action(async () => {
      try {
        const user = await auth.getCurrentUser()
        if (!user) {
          format.warn('未登录。请运行 linkvault auth login <email>')
          process.exit(1)
        }
        format.output(
          [{ field: '用户 ID', value: user.id }, { field: '邮箱', value: user.email }],
          [
            { key: 'field', header: '字段', width: 15 },
            { key: 'value', header: '值', width: 40 },
          ],
          'table'
        )
      } catch (err) {
        format.error(`获取用户信息失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
