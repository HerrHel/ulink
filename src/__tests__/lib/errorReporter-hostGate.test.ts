/**
 * 错误上报的环境门控：本机开发 / 测试地址的报错不写入线上 error_logs（2026-11-24）
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

const invokeSpy = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('../../lib/cloudbase.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/cloudbase.js')>()),
  isCloudBaseBackend: () => true,
  invokeCbFunction: (...args: unknown[]) => invokeSpy(...(args as [])),
}))

import {
  isLocalDevHost,
  isErrorReportingEnabled,
  reportError,
  _setReportingOverrideForTest,
} from '../../lib/errorReporter.js'

afterEach(() => {
  _setReportingOverrideForTest(null)
  invokeSpy.mockClear()
})

describe('errorReporter 环境门控', () => {
  it('本机开发 / 测试地址识别为本机', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]', '::1', 'app.localhost', 'ulink.test']) {
      expect(isLocalDevHost(h)).toBe(true)
    }
  })

  it('线上域名（含 CloudBase 默认域名）不算本机', () => {
    for (const h of ['ulink.ren', 'www.ulink.ren', 'ulink-d1g5srvjo54b1886a-1436146693.tcloudbaseapp.com', 'localhost.example.com', 'test.example.com']) {
      expect(isLocalDevHost(h)).toBe(false)
    }
  })

  it('开发构建 / 本机地址默认不上报：reportError 不调用云函数', () => {
    // vitest 下 import.meta.env.DEV 为 true，且 jsdom 地址是 localhost
    expect(isErrorReportingEnabled()).toBe(false)
    reportError({ message: 'dev-only error ' + Math.random() })
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  it('开关打开时照常上报（线上形态）', () => {
    _setReportingOverrideForTest(true)
    expect(isErrorReportingEnabled()).toBe(true)
    reportError({ message: 'prod error ' + Math.random() })
    expect(invokeSpy).toHaveBeenCalledTimes(1)
  })
})
