/**
 * config 命令 - 配置管理
 */
import { Command } from 'commander'
import { setConfig, getConfig, getConfigPath } from '../lib/config.js'
import { resetClient, testConnection } from '../lib/supabase.js'
import * as format from '../lib/format.js'

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('配置管理')

  config
    .command('set-url <url>')
    .description('设置 Supabase URL')
    .action((url: string) => {
      if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
        format.error('无效的 Supabase URL。格式应为: https://xxx.supabase.co')
        process.exit(1)
      }
      setConfig('supabaseUrl', url)
      resetClient()
      format.success(`Supabase URL 已设置: ${url}`)
    })

  config
    .command('set-key <key>')
    .description('设置 Supabase API Key (anon key 或 service role key)')
    .action((key: string) => {
      if (key.length < 10) {
        format.error('API Key 太短，请检查是否完整')
        process.exit(1)
      }
      setConfig('supabaseKey', key)
      resetClient()
      format.success('Supabase API Key 已设置')
    })

  config
    .command('show')
    .description('显示当前配置')
    .action(() => {
      const cfg = getConfig()
      const data = [
        { key: 'Supabase URL', value: cfg.supabaseUrl || '(未设置)' },
        { key: 'API Key', value: cfg.supabaseKey ? '***' + cfg.supabaseKey.slice(-8) : '(未设置)' },
        { key: 'Access Token', value: cfg.accessToken ? '已设置' : '(未设置)' },
        { key: '配置文件', value: getConfigPath() },
      ]
      format.output(
        data,
        [
          { key: 'key', header: '配置项', width: 20 },
          { key: 'value', header: '值', width: 50 },
        ],
        'table'
      )
    })

  config
    .command('test')
    .description('测试 Supabase 连接')
    .action(async () => {
      format.info('正在测试连接...')
      const ok = await testConnection()
      if (ok) {
        format.success('连接成功')
      } else {
        format.error('连接失败。请检查配置和网络')
        process.exit(1)
      }
    })
}
