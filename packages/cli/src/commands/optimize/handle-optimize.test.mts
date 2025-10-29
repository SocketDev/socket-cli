import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleOptimize } from './handle-optimize.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock('@socketsecurity/lib/constants/agents', () => ({
  VLT: 'vlt',
}))

vi.mock('./apply-optimization.mts', () => ({
  applyOptimization: vi.fn(),
}))
vi.mock('./output-optimize-result.mts', () => ({
  outputOptimizeResult: vi.fn(),
}))
vi.mock('./shared.mts', () => ({
  CMD_NAME: 'optimize',
}))
vi.mock('../../utils/process/cmd.mts', () => ({
  cmdPrefixMessage: vi.fn((cmd, msg) => `${cmd}: ${msg}`),
}))
vi.mock('../../utils/ecosystem/environment.mts', () => ({
  detectAndValidatePackageEnvironment: vi.fn(),
}))

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
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')
    const { outputOptimizeResult } = await import(
      './output-optimize-result.mts'
    )

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: {
        agent: 'npm',
        agentVersion: '10.0.0',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/package-lock.json',
      },
    })
    vi.mocked(applyOptimization).mockResolvedValue({
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

    expect(detectAndValidatePackageEnvironment).toHaveBeenCalledWith(
      '/test/project',
      expect.objectContaining({
        cmdName: 'optimize',
        prod: false,
      }),
    )
    expect(applyOptimization).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'npm',
        agentVersion: '10.0.0',
      }),
      { pin: false, prod: false },
    )
    expect(outputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      'json',
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('handles package environment validation failure', async () => {
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { outputOptimizeResult } = await import(
      './output-optimize-result.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
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

    expect(outputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      'text',
    )
    expect(applyOptimization).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('handles missing package environment details', async () => {
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { outputOptimizeResult } = await import(
      './output-optimize-result.mts'
    )

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: undefined,
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'json',
      pin: false,
      prod: true,
    })

    expect(outputOptimizeResult).toHaveBeenCalledWith(
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
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { outputOptimizeResult } = await import(
      './output-optimize-result.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: {
        agent: 'vlt',
        agentVersion: '1.0.0',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/vlt.lock',
      },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'markdown',
      pin: false,
      prod: false,
    })

    expect(outputOptimizeResult).toHaveBeenCalledWith(
      {
        ok: false,
        message: 'Unsupported',
        cause: 'optimize: vlt v1.0.0 does not support overrides.',
      },
      'markdown',
    )
    expect(applyOptimization).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('handles optimization failure', async () => {
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')
    const { outputOptimizeResult } = await import(
      './output-optimize-result.mts'
    )

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: {
        agent: 'yarn',
        agentVersion: '3.0.0',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/yarn.lock',
      },
    })
    vi.mocked(applyOptimization).mockResolvedValue({
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

    expect(applyOptimization).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'yarn' }),
      { pin: true, prod: true },
    )
    expect(outputOptimizeResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
      'json',
    )
    expect(process.exitCode).toBe(3)
  })

  it('handles pnpm package manager', async () => {
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')
    const { logger } = await import('@socketsecurity/lib/logger')

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: {
        agent: 'pnpm',
        agentVersion: '8.0.0',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/pnpm-lock.yaml',
      },
    })
    vi.mocked(applyOptimization).mockResolvedValue({
      ok: true,
      data: { optimizedCount: 3 },
    })

    await handleOptimize({
      cwd: '/test/project',
      outputKind: 'text',
      pin: false,
      prod: false,
    })

    expect(logger.info).toHaveBeenCalledWith(
      'Optimizing packages for pnpm v8.0.0.\n',
    )
    expect(applyOptimization).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'pnpm' }),
      { pin: false, prod: false },
    )
  })

  it('logs debug information', async () => {
    const { debug, debugDir } = await import('@socketsecurity/lib/debug')
    const { detectAndValidatePackageEnvironment } = await import(
      '../../utils/ecosystem/environment.mts'
    )
    const { applyOptimization } = await import('./apply-optimization.mts')

    vi.mocked(detectAndValidatePackageEnvironment).mockResolvedValue({
      ok: true,
      data: {
        agent: 'npm',
        agentVersion: '10.0.0',
        manifestPath: '/test/project/package.json',
        lockfilePath: '/test/project/package-lock.json',
      },
    })
    vi.mocked(applyOptimization).mockResolvedValue({
      ok: true,
      data: { optimizedCount: 2 },
    })

    await handleOptimize({
      cwd: '/debug/project',
      outputKind: 'json',
      pin: true,
      prod: false,
    })

    expect(debug).toHaveBeenCalledWith(
      'Starting optimization for /debug/project',
    )
    expect(debugDir).toHaveBeenCalledWith({
      cwd: '/debug/project',
      outputKind: 'json',
      pin: true,
      prod: false,
    })
    expect(debug).toHaveBeenCalledWith('Detected package manager: npm v10.0.0')
    expect(debug).toHaveBeenCalledWith('Applying optimization')
    expect(debug).toHaveBeenCalledWith('Optimization succeeded')
  })
})
