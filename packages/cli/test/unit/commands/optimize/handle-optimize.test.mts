import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Create hoisted mocks BEFORE any imports.
const { mockDetectAndValidatePackageEnvironment, mockApplyOptimization, mockOutputOptimizeResult } = vi.hoisted(() => ({
  mockDetectAndValidatePackageEnvironment: vi.fn(),
  mockApplyOptimization: vi.fn(),
  mockOutputOptimizeResult: vi.fn(),
}))

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock('@socketsecurity/lib/debug', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    debug: vi.fn(),
    debugDir: vi.fn(),
    debugNs: vi.fn(() => vi.fn()),
  }
})

vi.mock('@socketsecurity/lib/constants/agents', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    VLT: 'vlt',
  }
})

vi.mock('../../../../../src/commands/optimize/apply-optimization.mts', () => ({
  applyOptimization: mockApplyOptimization,
}))

vi.mock('../../../../../src/commands/optimize/output-optimize-result.mts', () => ({
  outputOptimizeResult: mockOutputOptimizeResult,
}))

vi.mock('../../../../../src/commands/optimize/shared.mts', () => ({
  CMD_NAME: 'optimize',
}))

vi.mock('../../../../../src/utils/process/cmd.mts', () => ({
  cmdPrefixMessage: vi.fn((cmd, msg) => `${cmd}: ${msg}`),
}))

vi.mock('../../../../../src/utils/ecosystem/environment.mts', () => ({
  detectAndValidatePackageEnvironment: mockDetectAndValidatePackageEnvironment,
}))

import { handleOptimize } from '../../../../../src/commands/optimize/handle-optimize.mts'

describe('handleOptimize', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('optimizes packages successfully', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: {
        agent: 'npm',
        agentVersion: { major: 10, minor: 0, patch: 0 },
        agentExecPath: '/usr/bin/npm',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/package-lock.json',
        pkgPath: '/test/project',
      },
    })
    mockApplyOptimization.mockResolvedValue({
      ok: true,
      data: {
        optimizedCount: 5,
        packages: ['pkg1', 'pkg2', 'pkg3', 'pkg4', 'pkg5'],
      },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'json',
      pin: false,
      prod: false,
    })

    expect(mockDetectAndValidatePackageEnvironment).toHaveBeenCalledWith(
      '/test/project',
      expect.objectContaining({
        cmdName: 'optimize',
        prod: false,
      }),
    )
    expect(mockApplyOptimization).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'npm',
      }),
      { pin: false, prod: false },
    )
    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      'json',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('handles package environment validation failure', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: false,
      code: 2,
      error: new Error('Invalid package environment'),
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'text',
      pin: true,
      prod: false,
    })

    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      'text',
    )
    expect(mockApplyOptimization).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('handles missing package environment details', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: undefined,
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'json',
      pin: false,
      prod: true,
    })

    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      {
        ok: false,
        message: 'No package found.',
        cause:
          'No valid package environment found for project path: /test/project',
      },
      'json',
    )
    expect(process.exitCode).toBe(1)
  })

  it('handles unsupported vlt package manager', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: {
        agent: 'vlt',
        agentVersion: { major: 1, minor: 0, patch: 0 },
        agentExecPath: '/usr/bin/vlt',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/vlt.lock',
        pkgPath: '/test/project',
      },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'markdown',
      pin: false,
      prod: false,
    })

    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      {
        ok: false,
        message: 'Unsupported',
        cause: 'optimize: vlt v1.0.0 does not support overrides.',
      },
      'markdown',
    )
    expect(mockApplyOptimization).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles optimization failure', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: {
        agent: 'yarn',
        agentVersion: { major: 3, minor: 0, patch: 0 },
        agentExecPath: '/usr/bin/yarn',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/yarn.lock',
        pkgPath: '/test/project',
      },
    })
    mockApplyOptimization.mockResolvedValue({
      ok: false,
      code: 3,
      error: new Error('Failed to apply optimization'),
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'json',
      pin: true,
      prod: true,
    })

    expect(mockApplyOptimization).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'yarn' }),
      { pin: true, prod: true },
    )
    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      'json',
    )
    expect(process.exitCode).toBe(3)
  })

  it('handles optimization with no changes', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: {
        agent: 'pnpm',
        agentVersion: { major: 8, minor: 0, patch: 0 },
        agentExecPath: '/usr/bin/pnpm',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/pnpm-lock.yaml',
        pkgPath: '/test/project',
      },
    })
    mockApplyOptimization.mockResolvedValue({
      ok: true,
      data: {
        optimizedCount: 0,
        packages: [],
      },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'text',
      pin: false,
      prod: false,
    })

    expect(mockApplyOptimization).toHaveBeenCalled()
    expect(mockOutputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ optimizedCount: 0 }),
      }),
      'text',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('passes pin and prod options correctly', async () => {
    mockDetectAndValidatePackageEnvironment.mockResolvedValue({
      ok: true,
      data: {
        agent: 'npm',
        agentVersion: { major: 10, minor: 0, patch: 0 },
        agentExecPath: '/usr/bin/npm',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/package-lock.json',
        pkgPath: '/test/project',
      },
    })
    mockApplyOptimization.mockResolvedValue({
      ok: true,
      data: {
        optimizedCount: 3,
        packages: ['pkg1', 'pkg2', 'pkg3'],
      },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'json',
      pin: true,
      prod: true,
    })

    expect(mockApplyOptimization).toHaveBeenCalledWith(
      expect.anything(),
      { pin: true, prod: true },
    )
  })
})
