import { afterEach, describe, expect, it, vi } from 'vitest'

import { NPM } from '../../../src/constants.mts'
import { isSea } from '../../../src/sea/runtime.mts'
import { shadowNpmInstall } from '../../../src/shadow/npm/install.mts'
import { runAgentInstall } from '../../../src/utils/agent.mts'

import type { EnvDetails } from '../../../src/utils/package-environment.mts'

vi.mock('../../../src/shadow/npm/install.mts', () => ({
  shadowNpmInstall: vi.fn(() => 'shadow-result'),
}))

vi.mock('../../../src/sea/runtime.mts', () => ({
  isSea: vi.fn(() => false),
}))

vi.mock('../../../src/utils/spawn.mts', () => ({
  spawn: vi.fn(() => 'spawn-result'),
}))

describe('runAgentInstall', () => {
  afterEach(() => vi.clearAllMocks())

  const npmDetails = {
    agent: NPM,
    agentExecPath: '/usr/bin/npm',
    agentVersion: { major: 10, minor: 0, patch: 0 },
    pkgPath: '/tmp/package',
  } as EnvDetails

  it('uses the npm shadow installer outside standalone SEA', () => {
    vi.mocked(isSea).mockReturnValue(false)

    expect(runAgentInstall(npmDetails, { args: ['--ignore-scripts'] })).toBe(
      'shadow-result',
    )
    expect(shadowNpmInstall).toHaveBeenCalledWith({
      agentExecPath: '/usr/bin/npm',
      cwd: '/tmp/package',
      args: ['--ignore-scripts'],
      spinner: undefined,
    })
  })

  it('runs npm directly in standalone SEA', () => {
    vi.mocked(isSea).mockReturnValue(true)

    expect(runAgentInstall(npmDetails)).toBe('spawn-result')
    expect(shadowNpmInstall).not.toHaveBeenCalled()
  })
})
