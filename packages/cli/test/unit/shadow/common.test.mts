/**
 * Unit tests for shadow package scanning utilities.
 *
 * Tests the common package scanning functionality used across all shadow
 * implementations (npm, pnpm, yarn, npx) to detect and alert on security risks.
 *
 * Test Coverage:
 * - Early return when command does not need scanning (run, test, etc.)
 * - Early return when --dry-run flag is present
 * - dlx/npx command scanning (packages from command arguments)
 * - add/install command scanning (packages from arguments or package.json)
 * - Empty package list handling
 * - package.json dependency scanning (dependencies, devDependencies, optionalDependencies, peerDependencies)
 * - Risk acceptance filter (acceptRisks flag)
 * - Alert detection and exit behavior when risks found
 * - Spinner integration and stopping on alerts
 * - Error handling (network errors, process.exit errors)
 *
 * Testing Approach:
 * - Mock all dependencies (fs, logger, socket API, npm utils)
 * - Test various command types and flag combinations
 * - Validate PURLs generation from npm specs
 * - Test alert filtering based on acceptRisks setting
 * - Verify process exit codes on security violations
 *
 * Related Files:
 * - src/shadow/common.mts - Common scanning implementation
 * - src/utils/socket/alerts.mts - Alert fetching
 * - src/utils/socket/package-alert.mts - Alert logging
 * - src/utils/npm/spec.mts - npm spec to PURL conversion
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FLAG_DRY_RUN } from '../../../src/constants/cli.mts'
import { scanPackagesAndLogAlerts } from '../../../src/shadow/common.mts'

import type { PackageScanOptions } from '../../../src/shadow/common.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

// Mock all dependencies.
const mockReadPackageJson = vi.hoisted(() => vi.fn())
const mockGetAlertsMapFromPurls = vi.hoisted(() => vi.fn())
const mockLogAlertsMap = vi.hoisted(() => vi.fn())
const mockSafeNpmSpecToPurl = vi.hoisted(() => vi.fn())
const mockIsAddCommand = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('node:fs', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
    },
  }
})

vi.mock('@socketsecurity/lib/packages', () => ({
  readPackageJson: mockReadPackageJson,
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('../../../src/utils/socket/alerts.mts', () => ({
  getAlertsMapFromPurls: mockGetAlertsMapFromPurls,
}))

vi.mock('../../../src/utils/socket/package-alert.mts', () => ({
  logAlertsMap: mockLogAlertsMap,
}))

vi.mock('../../../src/utils/npm/spec.mts', () => ({
  safeNpmSpecToPurl: mockSafeNpmSpecToPurl,
}))

vi.mock('../../../src/utils/process/cmd.mts', () => ({
  isAddCommand: mockIsAddCommand,
}))

describe('scanPackagesAndLogAlerts', () => {
  let mockSpinner: Spinner

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock spinner.
    mockSpinner = {
      stop: vi.fn(),
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as any

    // Default mock implementations.
    mockReadPackageJson.mockResolvedValue({
      dependencies: { lodash: '^4.17.21' },
      devDependencies: { '@types/node': '^20.0.0' },
      optionalDependencies: { fsevents: '^2.3.2' },
      peerDependencies: { react: '>=16.0.0' },
    })
    mockGetAlertsMapFromPurls.mockResolvedValue(new Map())
    mockSafeNpmSpecToPurl.mockImplementation((spec: string) => {
      // Return null for non-package arguments like flags
      if (spec.startsWith('-') || spec === '--') {
        return null
      }
      return `pkg:npm/${spec}`
    })
  })

  it('should return early when command does not need scanning', async () => {
    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'run',
      installCommands: new Set(['install', 'update']),
      managerName: 'npm',
      rawArgs: ['run', 'test'],
      viewAllRisks: false,
    }

    const result = await scanPackagesAndLogAlerts(options)

    expect(result).toEqual({ shouldExit: false })
    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should return early when dry-run flag is present', async () => {
    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install', FLAG_DRY_RUN],
      viewAllRisks: false,
    }

    const result = await scanPackagesAndLogAlerts(options)

    expect(result).toEqual({ shouldExit: false })
    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should scan packages from command arguments for dlx commands', async () => {
    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'dlx',
      dlxCommands: new Set(['dlx']),
      installCommands: new Set(['install']),
      managerName: 'pnpm',
      rawArgs: ['dlx', 'create-react-app', 'my-app'],
      viewAllRisks: false,
    }

    const result = await scanPackagesAndLogAlerts(options)

    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('create-react-app')
    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('my-app')
    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/create-react-app', 'pkg:npm/my-app'],
      {
        filter: { actions: ['error', 'monitor', 'warn'] },
        nothrow: true,
        spinner: undefined,
      },
    )
    expect(result.shouldExit).toBe(false)
  })

  it('should handle empty package list gracefully', async () => {
    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'add',
      installCommands: new Set(['install']),
      managerName: 'yarn',
      rawArgs: ['add'],
      viewAllRisks: false,
    }

    mockIsAddCommand.mockReturnValue(true)
    mockSafeNpmSpecToPurl.mockImplementation(() => null)

    const result = await scanPackagesAndLogAlerts(options)

    expect(result.shouldExit).toBe(false)
    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should scan packages from package.json for install commands', async () => {
    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install'],
      viewAllRisks: false,
    }

    mockIsAddCommand.mockImplementation((cmd: string) => cmd === 'add')

    const result = await scanPackagesAndLogAlerts(options)

    expect(mockReadPackageJson).toHaveBeenCalledWith(process.cwd())
    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('lodash@^4.17.21')
    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('@types/node@^20.0.0')
    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('fsevents@^2.3.2')
    expect(mockSafeNpmSpecToPurl).toHaveBeenCalledWith('react@>=16.0.0')
    expect(result.shouldExit).toBe(false)
  })

  it('should apply accept risks filter when acceptRisks is true', async () => {
    const options: PackageScanOptions = {
      acceptRisks: true,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install'],
      viewAllRisks: false,
    }

    await scanPackagesAndLogAlerts(options)

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { actions: ['error'], blocked: true },
      }),
    )
  })

  it('should exit with alerts when risks are found', async () => {
    const mockAlertsMap = new Map([
      [
        'pkg:npm/malicious-package',
        [{ action: 'error', description: 'Malicious code' }],
      ],
    ])
    mockGetAlertsMapFromPurls.mockResolvedValue(mockAlertsMap)

    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install'],
      spinner: mockSpinner,
      viewAllRisks: false,
    }

    const result = await scanPackagesAndLogAlerts(options)

    expect(mockSpinner.stop).toHaveBeenCalled()
    expect(mockLogAlertsMap).toHaveBeenCalledWith(mockAlertsMap, {
      hideAt: 'middle',
      output: process.stderr,
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Socket npm exiting due to risks'),
    )
    expect(result.shouldExit).toBe(true)
    expect(result.alertsMap).toBe(mockAlertsMap)
    expect(process.exitCode).toBe(1)
  })

  it('should handle scanning errors gracefully', async () => {
    mockGetAlertsMapFromPurls.mockRejectedValue(new Error('Network error'))

    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install'],
      spinner: mockSpinner,
      viewAllRisks: false,
    }

    const result = await scanPackagesAndLogAlerts(options)

    expect(mockSpinner.stop).toHaveBeenCalled()
    expect(result.shouldExit).toBe(false)
  })

  it('should re-throw process.exit errors from tests', async () => {
    const processExitError = new Error('process.exit called')
    mockGetAlertsMapFromPurls.mockRejectedValue(processExitError)

    const options: PackageScanOptions = {
      acceptRisks: false,
      command: 'install',
      installCommands: new Set(['install']),
      managerName: 'npm',
      rawArgs: ['install'],
      viewAllRisks: false,
    }

    await expect(scanPackagesAndLogAlerts(options)).rejects.toThrow(
      'process.exit called',
    )
  })
})
