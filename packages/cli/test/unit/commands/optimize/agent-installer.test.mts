/**
 * Unit tests for agent-installer utilities.
 *
 * Tests the package manager installation logic used by the optimize command.
 * These tests use mocked spawn/spinner to verify correct command construction.
 *
 * Test Coverage:
 * - pnpm: Special flags (--config.confirmModulesPurge=false, --no-frozen-lockfile, CI=1)
 * - yarn: Basic install command
 * - Custom args pass-through (--frozen-lockfile, --production, etc.)
 * - Spinner integration for progress indication
 * - Unknown/future package managers (fallback behavior)
 * - Option merging (args, env, stdio)
 *
 * npm Behavior (NOT tested here):
 * - npm uses shadowNpmInstall for security scanning
 * - This cannot be reliably mocked due to ESM module resolution issues
 * - npm behavior is tested via integration tests at:
 *   test/integration/cli/cmd-optimize.test.mts
 *
 * Related Files:
 * - src/commands/optimize/agent-installer.mts - Implementation
 * - src/shadow/npm/install.mts - npm shadow installation
 * - test/integration/cli/cmd-optimize.test.mts - Integration tests for full optimize flow
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runAgentInstall } from '../../../../../src/commands/optimize/agent-installer.mts'

// Mock dependencies.
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/spinner', () => ({
  Spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}))

vi.mock('../../../../../src/utils/process/cmd.mts', () => ({
  cmdFlagsToString: vi.fn(flags =>
    Object.entries(flags || {})
      .map(([k, v]) => `--${k}=${v}`)
      .join(' '),
  ),
}))

vi.mock('@socketsecurity/lib/constants/agents', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    NPM: 'npm',
    PNPM: 'pnpm',
    YARN: 'yarn',
  }
})

vi.mock('@socketsecurity/lib/constants/node', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    getNodeDisableSigusr1Flags: vi.fn(() => []),
    getNodeHardenFlags: vi.fn(() => []),
    getNodeNoWarningsFlags: vi.fn(() => []),
  }
})

vi.mock('@socketsecurity/lib/constants/platform', () => ({
  WIN32: false,
}))

describe('agent installer utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('runAgentInstall', () => {
    // Note: npm agent behavior (shadowNpmInstall) is covered by integration tests.
    // The mock-based test was removed due to ESM module resolution issues that
    // prevented proper interception. The 6 tests below cover pnpm/yarn/unknown agents.

    it('uses spawn for pnpm agent', async () => {
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { Spinner } = vi.mocked(await import('@socketsecurity/lib/spinner'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
      const { spawn } = vi.mocked(await import('@socketsecurity/lib/spawn'))
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
