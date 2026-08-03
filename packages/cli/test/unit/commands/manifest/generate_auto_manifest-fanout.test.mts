/**
 * Unit tests for generateAutoManifest — the maven and bazel legs plus the
 * fan-out invariants.
 *
 * A failed generator (non-zero exit code) aborts the whole run so a partial
 * SBOM never uploads silently; facts generators fold resolved paths into one
 * shared sidecar; the bazel leg's generated manifests surface in the result.
 *
 * Related Files:
 *
 * - Src/commands/manifest/generate_auto_manifest.mts
 * - Test/unit/commands/manifest/generate_auto_manifest.test.mts - sbt/gradle legs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SidecarAccumulator } from '../../../../src/commands/manifest/scripts/sidecar.mts'

const mockConvertSbtToFacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockConvertSbtToMaven = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockConvertGradleToFacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockConvertGradleToMaven = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockConvertMavenToFacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockHandleManifestConda = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockRunBazelAutoManifest = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockReadOrDefaultSocketJson = vi.hoisted(() =>
  vi.fn().mockReturnValue({}),
)
const mockOutputManifest = vi.hoisted(() => vi.fn())
const mockOutputRequirements = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  log: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock(
  import('../../../../src/commands/manifest/auto-manifest-bazel.mts'),
  () => ({
    runBazelAutoManifest: mockRunBazelAutoManifest,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-sbt-to-facts.mts'),
  () => ({
    convertSbtToFacts: mockConvertSbtToFacts,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-sbt-to-maven.mts'),
  () => ({
    convertSbtToMaven: mockConvertSbtToMaven,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-gradle-to-facts.mts'),
  () => ({
    convertGradleToFacts: mockConvertGradleToFacts,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-gradle-to-maven.mts'),
  () => ({
    convertGradleToMaven: mockConvertGradleToMaven,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-maven-to-facts.mts'),
  () => ({
    convertMavenToFacts: mockConvertMavenToFacts,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/handle-manifest-conda.mts'),
  () => ({
    handleManifestConda: mockHandleManifestConda,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/output-manifest.mts'),
  () => ({
    outputManifest: mockOutputManifest,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/output-requirements.mts'),
  () => ({
    outputRequirements: mockOutputRequirements,
  }),
)
vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

import { generateAutoManifest } from '../../../../src/commands/manifest/generate_auto_manifest.mts'

const baseDetected = {
  bazel: false,
  cdxgen: false,
  conda: false,
  count: 0,
  gradle: false,
  maven: false,
  sbt: false,
}

describe('generateAutoManifest fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadOrDefaultSocketJson.mockReturnValue({})
    mockRunBazelAutoManifest.mockResolvedValue([])
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('generates maven facts when maven is detected', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, maven: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertMavenToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        // The fake cwd ships no mvnw wrapper, so the invocation falls back to
        // `mvn` on PATH.
        bin: 'mvn',
        cwd: '/proj',
        mavenOpts: [],
      }),
    )
  })

  it('refuses socket.json mavenOpts without the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          maven: { mavenOpts: '-Dmaven.ext.class.path=/tmp/evil.jar' },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, maven: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
    expect(mockOutputManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused maven options'),
      }),
      'text',
      '-',
    )
  })

  it('skips maven when disabled in socket.json', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { maven: { disabled: true } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, maven: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
  })

  it('runs the bazel leg and returns its generated files', async () => {
    mockRunBazelAutoManifest.mockResolvedValueOnce([
      '/proj/.socket-auto-manifest/root__maven.maven_install.json',
    ])

    const result = await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, bazel: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockRunBazelAutoManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/proj',
        trustSocketJson: false,
      }),
    )
    expect(result.generatedFiles).toEqual([
      '/proj/.socket-auto-manifest/root__maven.maven_install.json',
    ])
  })

  it('skips bazel when disabled in socket.json', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { bazel: { disabled: true } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, bazel: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockRunBazelAutoManifest).not.toHaveBeenCalled()
  })

  it('aborts the run when a generator fails', async () => {
    // A failed generator reports through the process exit code (it already
    // logged the specifics); the fan-out must abort instead of uploading a
    // partial SBOM.
    mockConvertGradleToFacts.mockImplementationOnce(() => {
      process.exitCode = 1
      return Promise.resolve(undefined)
    })

    await expect(
      generateAutoManifest({
        cwd: '/proj',
        detected: { ...baseDetected, gradle: true, maven: true },
        outputKind: 'text',
        trustSocketJson: false,
        verbose: false,
      }),
    ).rejects.toThrow(
      'Auto-manifest generation failed for the gradle project; aborting',
    )

    // The abort fires before later legs run.
    expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
  })

  it('does not abort when the exit code was already non-zero before the run', async () => {
    process.exitCode = 1

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).toHaveBeenCalled()
  })

  it('accumulates one sidecar across all facts generators', async () => {
    const sbtComponent = {
      classifier: undefined,
      ext: 'jar',
      group: 'org.example',
      name: 'from-sbt',
      sources: [],
      targets: ['/proj/libs/from-sbt.jar'],
      version: '1.0.0',
    }
    const gradleComponent = {
      classifier: undefined,
      ext: 'jar',
      group: 'org.example',
      name: 'from-gradle',
      sources: [],
      targets: ['/proj/libs/from-gradle.jar'],
      version: '2.0.0',
    }
    mockConvertSbtToFacts.mockImplementationOnce(
      ({ sidecarAcc }: { sidecarAcc: SidecarAccumulator }) => {
        sidecarAcc.set('org.example:from-sbt:jar::1.0.0', {
          ...sbtComponent,
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
          classifier: null,
        })
        return Promise.resolve(undefined)
      },
    )
    mockConvertGradleToFacts.mockImplementationOnce(
      ({ sidecarAcc }: { sidecarAcc: SidecarAccumulator }) => {
        sidecarAcc.set('org.example:from-gradle:jar::2.0.0', {
          ...gradleComponent,
          // oxlint-disable-next-line socket/prefer-undefined-over-null -- frozen sidecar contract serializes an explicit JSON null
          classifier: null,
        })
        return Promise.resolve(undefined)
      },
    )

    const result = await generateAutoManifest({
      computeArtifactsSidecar: true,
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    // Both generators received the SAME accumulator and their entries merge
    // into one serialized (sorted) sidecar.
    const sbtAcc = mockConvertSbtToFacts.mock.calls[0]![0].sidecarAcc
    const gradleAcc = mockConvertGradleToFacts.mock.calls[0]![0].sidecarAcc
    expect(sbtAcc).toBe(gradleAcc)
    expect(mockConvertSbtToFacts).toHaveBeenCalledWith(
      expect.objectContaining({ withFiles: true }),
    )
    expect(result.resolvedPathsSidecar?.map(c => c.name)).toEqual([
      'from-gradle',
      'from-sbt',
    ])
  })

  it('omits the sidecar when computeArtifactsSidecar is off', async () => {
    const result = await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        sidecarAcc: undefined,
        withFiles: undefined,
      }),
    )
    expect(result.resolvedPathsSidecar).toBeUndefined()
  })

  it('omits the sidecar when no generator resolved any paths', async () => {
    const result = await generateAutoManifest({
      computeArtifactsSidecar: true,
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(result.resolvedPathsSidecar).toBeUndefined()
  })
})
