/**
 * 配置管理
 * 使用 conf 库持久化配置到 ~/.linkvault/config.json
 */
import Conf from 'conf'
import type { CliConfig } from '../types.js'

const config = new Conf<CliConfig>({
  projectName: 'linkvault',
  defaults: {},
})

/** 获取配置值 */
export function getConfig(): CliConfig {
  return config.store
}

/** 获取 Supabase URL */
export function getSupabaseUrl(): string | undefined {
  return config.get('supabaseUrl')
}

/** 获取 Supabase Key */
export function getSupabaseKey(): string | undefined {
  return config.get('supabaseKey')
}

/** 获取 Access Token */
export function getAccessToken(): string | undefined {
  return config.get('accessToken')
}

/** 获取 Refresh Token */
export function getRefreshToken(): string | undefined {
  return config.get('refreshToken')
}

/** 设置配置值 */
export function setConfig(key: keyof CliConfig, value: string): void {
  config.set(key, value)
}

/** 清除所有配置 */
export function clearConfig(): void {
  config.clear()
}

/** 检查配置是否完整 */
export function isConfigured(): boolean {
  const url = getSupabaseUrl()
  const key = getSupabaseKey()
  return Boolean(url && key)
}

/** 获取配置文件路径 */
export function getConfigPath(): string {
  return config.path
}
