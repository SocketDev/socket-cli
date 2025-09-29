import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runAgentInstall } from './agent-installer.mts'

// Mock dependencies.
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/spinner', () => ({
  Spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

vi.mock('../../shadow/npm/install.mts', () => ({
  shadowNpmInstall: vi.fn(),
}))

vi.mock('../../utils/cmd.mts', () => ({
  cmdFlagsToString: vi.fn(flags =>
    Object.entries(flags || {})
      .map(([k, v]) => `--${k}=${v}`)
      .join(' '),
  ),
}))

vi.mock('../../constants.mts', () => ({
  default: {
    nodeHardenFlags: [],
    nodeNoWarningsFlags: [],
  },
  NPM: 'npm',
  PNPM: 'pnpm',
}))

describe('agent installer utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('runAgentInstall', () => {
    it('uses shadowNpmInstall for npm agent', async () => {
      const { shadowNpmInstall } = vi.mocked(
        await import('../../shadow/npm/install.mts'),
      )
      shadowNpmInstall.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'npm',
        agentExecPath: '/usr/bin/npm',
        pkgPath: '/test/project',
      } as any

      runAgentInstall(pkgEnvDetails)

      expect(shadowNpmInstall).toHaveBeenCalledWith({
        agentExecPath: '/usr/bin/npm',
        cwd: '/test/project',
      })
    })

    it('uses spawn for pnpm agent', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'pnpm',
        agentExecPath: '/usr/bin/pnpm',
        pkgPath: '/test/project',
        agentVersion: { major: 8, minor: 0, patch: 0 },
      } as any

      runAgentInstall(pkgEnvDetails)

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/pnpm',
        [
          'install',
          '--config.confirmModulesPurge=false',
          '--no-frozen-lockfile',
        ],
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            CI: '1',
          }),
        }),
      )
    })

    it('uses spawn for yarn agent', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'yarn',
        agentExecPath: '/usr/bin/yarn',
        pkgPath: '/test/project',
      } as any

      runAgentInstall(pkgEnvDetails)

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/yarn',
        ['install'],
        expect.objectContaining({
          cwd: '/test/project',
        }),
      )
    })

    it('passes args to the agent command', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'yarn',
        agentExecPath: '/usr/bin/yarn',
        pkgPath: '/test/project',
      } as any

      runAgentInstall(pkgEnvDetails, {
        args: ['--frozen-lockfile', '--production'],
      })

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/yarn',
        ['install', '--frozen-lockfile', '--production'],
        expect.any(Object),
      )
    })

    it('uses spinner when provided', async () => {
      const { Spinner } = vi.mocked(
        await import('@socketsecurity/registry/lib/spinner'),
      )
      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
      }
      Spinner.mockReturnValue(mockSpinner as any)

      const pkgEnvDetails = {
        agent: 'pnpm',
        agentExecPath: '/usr/bin/pnpm',
        pkgPath: '/test/project',
        agentVersion: { major: 8, minor: 0, patch: 0 },
      } as any

      runAgentInstall(pkgEnvDetails, {
        spinner: mockSpinner as any,
      })

      // Spinner would be passed through to spawn.
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/pnpm',
        [
          'install',
          '--config.confirmModulesPurge=false',
          '--no-frozen-lockfile',
        ],
        expect.objectContaining({
          spinner: mockSpinner,
        }),
      )
    })

    it('handles unknown agent', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'unknown-agent',
        agentExecPath: '/usr/bin/unknown-agent',
        pkgPath: '/test/project',
      } as any

      runAgentInstall(pkgEnvDetails)

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/unknown-agent',
        ['install'],
        expect.any(Object),
      )
    })

    it('merges options correctly', async () => {
      const { spawn } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawn.mockReturnValue(Promise.resolve({ status: 0 }) as any)

      const pkgEnvDetails = {
        agent: 'yarn',
        agentExecPath: '/usr/bin/yarn',
        pkgPath: '/test/project',
      } as any

      const options = {
        args: ['--prod'],
        env: { NODE_ENV: 'production' },
        stdio: 'inherit' as const,
      }

      runAgentInstall(pkgEnvDetails, options)

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/yarn',
        ['install', '--prod'],
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            NODE_ENV: 'production',
          }),
          stdio: 'inherit',
        }),
      )
    })
  })
})
