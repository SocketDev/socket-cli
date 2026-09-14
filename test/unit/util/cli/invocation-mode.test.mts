import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getInvocationMode,
  getScriptInvocationMode,
} from '../../../../src/util/cli/invocation-mode.mts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('CLI invocation modes', () => {
  it.each([
    ['socket-npm', 'npm'],
    ['npm', 'npm'],
    ['socket-npx', 'npx'],
    ['socket-pnpm', 'pnpm'],
    ['socket-yarn', 'yarn'],
    ['socket', 'socket'],
    ['cli', 'socket'],
    ['unrelated', undefined],
  ])('maps script %s', (script, expected) => {
    expect(getScriptInvocationMode(script!)).toBe(expected)
  })

  it('gives the explicit environment mode precedence', () => {
    vi.stubEnv('SOCKET_CLI_MODE', 'yarn')
    expect(getInvocationMode()).toBe('yarn')
  })

  it('uses the script basename when no mode is set', () => {
    vi.stubEnv('SOCKET_CLI_MODE', '')
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      process.execPath,
      '/fixture/socket-pnpm.mjs',
    ])
    expect(getInvocationMode()).toBe('pnpm')
  })
})
