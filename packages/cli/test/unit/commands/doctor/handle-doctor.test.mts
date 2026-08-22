import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleDoctor } from '../../../../src/commands/doctor/handle-doctor.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const detectMock = vi.hoisted(() => vi.fn())
const ensureMock = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('../../../../src/util/ecosystem/environment.mts'), () => ({
  detectAndValidatePackageEnvironment: detectMock,
}))

vi.mock(
  import('../../../../src/commands/optimize/update-pnpm-workspace-yaml.mts'),
  () => ({
    ensurePnpmWorkspaceMinReleaseAge: ensureMock,
  }),
)

const sfwWrapMock = vi.hoisted(() => vi.fn(() => []))
const workflowSocketMock = vi.hoisted(() => vi.fn(() => []))

vi.mock(import('../../../../src/commands/doctor/practice-checks.mts'), () => ({
  checkSfwWrap: sfwWrapMock,
  checkWorkflowSocket: workflowSocketMock,
}))

function pnpmEnv() {
  return {
    ok: true,
    data: {
      agent: 'pnpm',
      agentVersion: { version: '11.19.0' },
      pkgPath: '/repo',
    },
  }
}

describe('handleDoctor', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('warns instead of silently passing on a non-pnpm agent', async () => {
    detectMock.mockResolvedValue({
      ok: true,
      data: {
        agent: 'npm',
        agentVersion: { version: '12.0.0' },
        pkgPath: '/repo',
      },
    })
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(ensureMock).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('soak-time: not enforceable under npm'),
    )
  })

  it('reports the added enforcement', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('added')
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(ensureMock).toHaveBeenCalledWith('/repo')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'soak-time: enforced at 7 days (minimumReleaseAge added',
      ),
    )
  })

  it('reports the raised enforcement', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('raised')
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('soak-time: raised to 7 days'),
    )
  })

  it('reports already-enforced', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('present')
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('soak-time: already enforced at 7 days'),
    )
  })

  it('emits the structured report in json mode', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('present')
    await handleDoctor({ cwd: '.', outputKind: 'json' })
    expect(mockLogger.log).toHaveBeenCalledWith(
      JSON.stringify(
        {
          minReleaseAge: { enforceable: true, outcome: 'present' },
          practices: { violations: [] },
        },
        undefined,
        2,
      ),
    )
  })

  it('reports a clean practice gate', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('present')
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('workflows + sfw: clean'),
    )
    expect(process.exitCode).toBeUndefined()
  })

  it('fails loud with the violating file and line', async () => {
    detectMock.mockResolvedValue(pnpmEnv())
    ensureMock.mockResolvedValue('present')
    sfwWrapMock.mockReturnValue([
      {
        file: '.github/workflows/ci.yml',
        line: 4,
        practice: 'sfw',
        text: 'run: pnpm install',
      },
    ])
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('.github/workflows/ci.yml:4'),
    )
    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining('1 practice violation(s)'),
    )
    expect(process.exitCode).toBe(1)
  })

  it('fails loud when the environment is invalid', async () => {
    detectMock.mockResolvedValue({
      ok: false,
      code: 1,
      message: 'Missing lockfile',
      cause: 'doctor: No lockfile found',
    })
    await handleDoctor({ cwd: '.', outputKind: 'text' })
    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining('No lockfile found'),
    )
  })
})
