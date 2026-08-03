/**
 * Unit tests for the Bazel leg of --auto-manifest.
 *
 * Trust gate: socket.json's executing bazel settings (bazel/bin, bazelFlags,
 * bazelRc, bazelOutputBase) are refused without --trust-socket-json;
 * non-executing settings (ecosystems, verbose) are honored untrusted. Outcome
 * gate: hardFailure aborts, partial warns but uploads, all-noEcosystem is a
 * tolerated no-op, and a lockfile-covered `complete` run with zero synthetic
 * manifests is a correct no-op.
 *
 * Related Files:
 *
 * - Src/commands/manifest/auto-manifest-bazel.mts
 * - Src/commands/manifest/bazel/cmd-manifest-bazel.mts (shared outcome gate)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExtractBazelToMaven = vi.hoisted(() => vi.fn())
const mockExtractBazelToPypi = vi.hoisted(() => vi.fn())
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock(
  import('../../../../src/commands/manifest/bazel/extract_bazel_to_maven.mts'),
  () => ({
    extractBazelToMaven: mockExtractBazelToMaven,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/bazel/extract_bazel_to_pypi.mts'),
  () => ({
    extractBazelToPypi: mockExtractBazelToPypi,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/output-manifest.mts'),
  () => ({
    outputManifest: mockOutputManifest,
  }),
)

import {
  resolveBazelAutoEcosystems,
  resolveBazelAutoSettings,
  runBazelAutoManifest,
} from '../../../../src/commands/manifest/auto-manifest-bazel.mts'
import { InputError } from '../../../../src/util/error/errors-types.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

function socketJsonWithBazel(
  bazel: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { bazel } } } as unknown as SocketJson
}

const completeMavenResult = {
  artifactCount: 3,
  complete: true,
  manifestPaths: ['/proj/.socket-auto-manifest/root__maven.maven_install.json'],
  status: 'complete',
  workspaceOutcomes: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExtractBazelToMaven.mockResolvedValue(completeMavenResult)
  mockExtractBazelToPypi.mockResolvedValue({
    artifactCount: 0,
    noEcosystemFound: true,
    ok: false,
  })
})

describe('resolveBazelAutoSettings', () => {
  it.each([
    ['bazel', { bazel: '/evil/bazel' }],
    ['bin', { bin: '/evil/bazel' }],
    ['bazelFlags', { bazelFlags: '--config=evil' }],
    ['bazelRc', { bazelRc: '/evil/.bazelrc' }],
    ['bazelOutputBase', { bazelOutputBase: '/evil/base' }],
  ])(
    'refuses a socket.json %s without the trust flag',
    (field, bazelConfig) => {
      const result = resolveBazelAutoSettings({
        cwd: '/proj',
        socketJson: socketJsonWithBazel(bazelConfig),
        trustSocketJson: false,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toContain('Refused bazel settings')
        expect(result.cause).toContain(field)
      }
    },
  )

  it('honors socket.json executing settings under the trust flag', () => {
    const result = resolveBazelAutoSettings({
      cwd: '/proj',
      socketJson: socketJsonWithBazel({
        bazel: '/opt/bazelisk',
        bazelFlags: '--config=remote',
      }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toEqual({
      bazelFlags: '--config=remote',
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: '/opt/bazelisk',
    })
  })

  it('passes with no socket.json bazel settings', () => {
    const result = resolveBazelAutoSettings({
      cwd: '/proj',
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBeUndefined()
  })
})

describe('resolveBazelAutoEcosystems', () => {
  it('defaults to maven only', () => {
    expect(resolveBazelAutoEcosystems(undefined)).toEqual(['maven'])
    expect(resolveBazelAutoEcosystems(socketJsonWithBazel({}))).toEqual([
      'maven',
    ])
  })

  it('honors a pypi opt-in', () => {
    expect(
      resolveBazelAutoEcosystems(
        socketJsonWithBazel({ ecosystems: ['maven', 'pypi'] }),
      ),
    ).toEqual(['maven', 'pypi'])
  })

  it('throws on an unsupported ecosystem value', () => {
    expect(() =>
      resolveBazelAutoEcosystems(socketJsonWithBazel({ ecosystems: ['npm'] })),
    ).toThrow('Unsupported Bazel ecosystem')
  })
})

describe('runBazelAutoManifest', () => {
  it('extracts maven with the auto defaults (flat layout, scan-dir out, unset timeout)', async () => {
    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: undefined,
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockExtractBazelToMaven).toHaveBeenCalledWith({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: '/proj',
      out: '/proj',
      outLayout: 'flat',
      // Unset selects the extractor's short auto-manifest default (60s).
      perRepoTimeoutMs: undefined,
      verbose: false,
    })
    expect(mockExtractBazelToPypi).not.toHaveBeenCalled()
    expect(generated).toEqual(completeMavenResult.manifestPaths)
  })

  it('runs the pypi extraction when socket.json opts in', async () => {
    mockExtractBazelToPypi.mockResolvedValueOnce({
      artifactCount: 2,
      manifestPath: '/proj/.socket-auto-manifest/requirements.txt',
      ok: true,
    })

    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: socketJsonWithBazel({ ecosystems: ['maven', 'pypi'] }),
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockExtractBazelToPypi).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/proj',
        out: '/proj',
        outLayout: 'flat',
      }),
    )
    expect(generated).toEqual([
      ...completeMavenResult.manifestPaths,
      '/proj/.socket-auto-manifest/requirements.txt',
    ])
  })

  it('throws on a hard failure so the wider scan aborts', async () => {
    mockExtractBazelToMaven.mockResolvedValueOnce({
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes: [],
    })

    await expect(
      runBazelAutoManifest({
        cwd: '/proj',
        outputKind: 'text',
        socketJson: undefined,
        trustSocketJson: false,
        verbose: false,
      }),
    ).rejects.toThrow(InputError)
  })

  it('tolerates an all-noEcosystem outcome as a no-op', async () => {
    mockExtractBazelToMaven.mockResolvedValueOnce({
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'noEcosystem',
      workspaceOutcomes: [],
    })

    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: undefined,
      trustSocketJson: false,
      verbose: false,
    })

    expect(generated).toEqual([])
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('No supported Bazel ecosystems detected'),
    )
  })

  it('warns loud on a partial run but still returns its manifests', async () => {
    mockExtractBazelToMaven.mockResolvedValueOnce({
      artifactCount: 1,
      complete: false,
      manifestPaths: ['/proj/.socket-auto-manifest/root__maven.json'],
      status: 'partial',
      workspaceOutcomes: [],
    })

    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: undefined,
      trustSocketJson: false,
      verbose: false,
    })

    expect(generated).toEqual(['/proj/.socket-auto-manifest/root__maven.json'])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PARTIAL'),
    )
  })

  it('treats a lockfile-covered complete run with zero files as a correct no-op', async () => {
    mockExtractBazelToMaven.mockResolvedValueOnce({
      artifactCount: 0,
      complete: true,
      manifestPaths: [],
      status: 'complete',
      workspaceOutcomes: [],
    })

    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: undefined,
      trustSocketJson: false,
      verbose: false,
    })

    expect(generated).toEqual([])
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('refuses untrusted socket.json executing settings and skips extraction', async () => {
    const generated = await runBazelAutoManifest({
      cwd: '/proj',
      outputKind: 'text',
      socketJson: socketJsonWithBazel({ bazel: '/evil/bazel' }),
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockExtractBazelToMaven).not.toHaveBeenCalled()
    expect(mockOutputManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused bazel settings'),
      }),
      'text',
      '-',
    )
    expect(generated).toEqual([])
  })
})
