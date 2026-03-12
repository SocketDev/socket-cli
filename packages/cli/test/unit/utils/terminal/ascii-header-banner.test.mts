/**
 * Unit tests for ASCII header banner utility.
 *
 * Purpose:
 * Tests the ASCII header banner generation for CLI commands.
 *
 * Test Coverage:
 * - getAsciiHeader function
 * - Compact mode output
 * - Token display
 * - Org display
 * - Version display
 *
 * Related Files:
 * - src/utils/terminal/ascii-header-banner.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
vi.mock('yoctocolors-cjs', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}))

const mockGetCI = vi.hoisted(() => vi.fn(() => false))
vi.mock('@socketsecurity/lib/env/ci', () => ({
  getCI: mockGetCI,
}))

const mockGetSocketCliApiToken = vi.hoisted(() => vi.fn(() => ''))
const mockGetSocketCliNoApiToken = vi.hoisted(() => vi.fn(() => false))
vi.mock('@socketsecurity/lib/env/socket-cli', () => ({
  getSocketCliApiToken: mockGetSocketCliApiToken,
  getSocketCliNoApiToken: mockGetSocketCliNoApiToken,
}))

vi.mock('@socketsecurity/lib/paths/normalize', () => ({
  normalizePath: (p: string) => p,
}))

vi.mock('../../../../src/constants/cli.mts', () => ({
  FLAG_ORG: '--org',
  REDACTED: '[REDACTED]',
}))

vi.mock('../../../../src/constants/config.mts', () => ({
  CONFIG_KEY_API_TOKEN: 'apiToken',
  CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
}))

const mockGetCliVersion = vi.hoisted(() => vi.fn(() => '1.0.0'))
vi.mock('../../../../src/env/cli-version.mts', () => ({
  getCliVersion: mockGetCliVersion,
}))

const mockGetCliVersionHash = vi.hoisted(() => vi.fn(() => 'abc123'))
vi.mock('../../../../src/env/cli-version-hash.mts', () => ({
  getCliVersionHash: mockGetCliVersionHash,
}))

// Mock VITEST as false to test non-test mode.
vi.mock('../../../../src/env/vitest.mts', () => ({
  VITEST: false,
}))

const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn(() => undefined))
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
  isConfigFromFlag: mockIsConfigFromFlag,
}))

const mockIsDebug = vi.hoisted(() => vi.fn(() => false))
vi.mock('../../../../src/utils/debug.mts', () => ({
  isDebug: mockIsDebug,
}))

vi.mock('../../../../src/utils/terminal/ascii-header.mts', () => ({
  renderLogoWithFallback: () => 'LOGO',
  supportsFullColor: () => false,
}))

vi.mock('../../../../src/utils/fs/home-path.mts', () => ({
  tildify: (p: string) => p,
}))

const mockGetVisibleTokenPrefix = vi.hoisted(() => vi.fn(() => ''))
vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  getVisibleTokenPrefix: mockGetVisibleTokenPrefix,
}))

import { getAsciiHeader } from '../../../../src/utils/terminal/ascii-header-banner.mts'

describe('ascii-header-banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCI.mockReturnValue(false)
    mockGetSocketCliApiToken.mockReturnValue('')
    mockGetSocketCliNoApiToken.mockReturnValue(false)
    mockGetConfigValueOrUndef.mockReturnValue(undefined)
    mockGetVisibleTokenPrefix.mockReturnValue('')
    mockIsDebug.mockReturnValue(false)
  })

  describe('getAsciiHeader', () => {
    describe('compact mode', () => {
      it('returns compact header in compact mode', () => {
        mockGetCI.mockReturnValue(true)
        mockGetConfigValueOrUndef.mockImplementation((key: string) =>
          key === 'defaultOrg' ? 'my-org' : undefined,
        )

        const header = getAsciiHeader('scan create', undefined, true)

        expect(header).toContain('CLI:')
        expect(header).toContain('cmd: scan create')
        expect(header).toContain('org: my-org')
        expect(header).toContain('token: (not set)')
      })

      it('shows org flag in compact mode', () => {
        mockGetCI.mockReturnValue(true)

        const header = getAsciiHeader('scan create', 'flag-org', true)

        expect(header).toContain('org: flag-org')
      })

      it('shows token prefix in compact mode', () => {
        mockGetCI.mockReturnValue(true)
        mockGetVisibleTokenPrefix.mockReturnValue('sk_live_')
        mockGetSocketCliApiToken.mockReturnValue('sk_live_xxxxx')

        const header = getAsciiHeader('scan create', undefined, true)

        expect(header).toContain('sk_live_***')
        expect(header).toContain('(env)')
      })

      it('shows disabled token in compact mode', () => {
        mockGetCI.mockReturnValue(true)
        mockGetSocketCliNoApiToken.mockReturnValue(true)

        const header = getAsciiHeader('scan create', undefined, true)

        expect(header).toContain('token: (disabled)')
      })
    })

    describe('full mode', () => {
      it('includes logo and info lines', () => {
        mockGetCI.mockReturnValue(true) // Use CI mode for plain logo

        const header = getAsciiHeader('fix', undefined, false)

        // The plain logo contains "Socket" (in ASCII art style).
        expect(header).toContain('_____')
        expect(header).toContain('CLI:')
        expect(header).toContain('Command: `fix`')
      })

      it('shows org from flag', () => {
        mockGetCI.mockReturnValue(true)

        const header = getAsciiHeader('scan', 'my-org', false)

        expect(header).toContain('org: my-org (--org flag)')
      })

      it('shows org from config', () => {
        mockGetCI.mockReturnValue(true)
        mockGetConfigValueOrUndef.mockImplementation((key: string) =>
          key === 'defaultOrg' ? 'config-org' : undefined,
        )

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('org: config-org (config)')
      })

      it('shows not set when no org', () => {
        mockGetCI.mockReturnValue(true)

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('org: (not set)')
      })

      it('shows token with env origin', () => {
        mockGetCI.mockReturnValue(true)
        mockGetSocketCliApiToken.mockReturnValue('sk_live_test')
        mockGetVisibleTokenPrefix.mockReturnValue('sk_live_')

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('sk_live_***')
        expect(header).toContain('(env)')
      })

      it('shows token with config origin', () => {
        mockGetCI.mockReturnValue(true)
        mockGetVisibleTokenPrefix.mockReturnValue('sk_live_')
        mockGetConfigValueOrUndef.mockImplementation((key: string) =>
          key === 'apiToken' ? 'sk_live_config' : undefined,
        )

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('sk_live_***')
        expect(header).toContain('(config)')
      })

      it('shows disabled token', () => {
        mockGetCI.mockReturnValue(true)
        mockGetSocketCliNoApiToken.mockReturnValue(true)

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('(disabled)')
      })

      it('shows node version in debug mode', () => {
        mockGetCI.mockReturnValue(true)
        mockIsDebug.mockReturnValue(true)

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('Node:')
      })

      it('shows version hash in debug mode', () => {
        mockGetCI.mockReturnValue(true)
        mockIsDebug.mockReturnValue(true)

        const header = getAsciiHeader('scan', undefined, false)

        expect(header).toContain('abc123')
      })
    })

    describe('theme support', () => {
      it('accepts valid theme flag', () => {
        mockGetCI.mockReturnValue(true)

        // Valid theme should not throw.
        const header = getAsciiHeader('scan', undefined, false, {
          headerTheme: 'cyberpunk',
        })

        expect(header).toBeDefined()
      })

      it('falls back to default for invalid theme', () => {
        mockGetCI.mockReturnValue(true)

        // Invalid theme should fall back to default.
        const header = getAsciiHeader('scan', undefined, false, {
          headerTheme: 'invalid',
        })

        expect(header).toBeDefined()
      })
    })
  })
})
