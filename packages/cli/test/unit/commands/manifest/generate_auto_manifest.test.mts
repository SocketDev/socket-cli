/**
 * Unit tests for generateAutoManifest — the sbt and gradle legs.
 *
 * Facts generation is the default for both legs (opt out per tool with
 * socket.json `defaults.manifest.<x>.facts: false`);
 * `defaults.manifest.<x>.disabled` skips a leg entirely. Executing settings
 * from socket.json route through the trust gate.
 *
 * Related Files:
 *
 * - Src/commands/manifest/generate_auto_manifest.mts
 * - Test/unit/commands/manifest/generate_auto_manifest-fanout.test.mts -
 *   maven/bazel legs, abort-on-failure, and sidecar accumulation
 * - Test/unit/commands/manifest/generate_auto_manifest-conda.test.mts - conda leg
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

describe('generateAutoManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadOrDefaultSocketJson.mockReturnValue({})
    mockRunBazelAutoManifest.mockResolvedValue([])
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('logs socket.json defaults when verbose', async () => {
    const sockJson = { defaults: {} }
    mockReadOrDefaultSocketJson.mockReturnValueOnce(sockJson)

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: true,
    })

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('socket.json'),
      sockJson,
    )
  })

  it('generates sbt facts by default when sbt is detected', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'sbt',
        cwd: '/proj',
        excludeConfigs: '',
        ignoreUnresolved: false,
        includeConfigs: '',
        sbtOpts: [],
      }),
    )
    expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Scala sbt build'),
    )
  })

  it('generates sbt poms when socket.json opts out of facts', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { sbt: { facts: false } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).not.toHaveBeenCalled()
    expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'sbt',
        cwd: '/proj',
        out: './socket.sbt.pom.xml',
        sbtOpts: [],
      }),
    )
  })

  it('does not log sbt detection in non-text mode', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'json',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).toHaveBeenCalled()
    expect(mockLogger.log).not.toHaveBeenCalled()
  })

  it('skips sbt when disabled in socket.json', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { sbt: { disabled: true } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).not.toHaveBeenCalled()
    expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
  })

  it('refuses a socket.json sbt bin and opts without the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          sbt: {
            bin: '/custom/sbt',
            sbtOpts: '--debug --noisy',
            verbose: true,
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).not.toHaveBeenCalled()
    expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
    expect(mockOutputManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused a sbt binary'),
      }),
      'text',
      '-',
    )
  })

  it('forwards sbt overrides from socket.json under the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          sbt: {
            bin: '/custom/sbt',
            excludeConfigs: 'test*',
            ignoreUnresolved: true,
            includeConfigs: '*Classpath',
            sbtOpts: '--debug --noisy',
            verbose: true,
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: true,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/custom/sbt',
        excludeConfigs: 'test*',
        ignoreUnresolved: true,
        includeConfigs: '*Classpath',
        sbtOpts: ['--debug', '--noisy'],
        verbose: true,
      }),
    )
  })

  it('generates gradle facts by default when gradle is detected', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        // The fake cwd ships no gradlew wrapper, so the invocation falls back
        // to `gradle` on PATH.
        bin: 'gradle',
        cwd: '/proj',
        gradleOpts: [],
        verbose: false,
      }),
    )
    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
  })

  it('generates gradle poms when socket.json opts out of facts', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { gradle: { facts: false } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).not.toHaveBeenCalled()
    expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'gradle',
        cwd: '/proj',
        gradleOpts: [],
      }),
    )
  })

  it('refuses a socket.json gradle bin outside the wrapper without the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          gradle: {
            bin: 'tools/gradlew',
            gradleOpts: '--info --stacktrace',
            verbose: true,
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'json',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).not.toHaveBeenCalled()
    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
    expect(mockOutputManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused a gradle binary'),
      }),
      'json',
      '-',
    )
  })

  it('refuses socket.json gradleOpts even when the bin is the wrapper', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          gradle: {
            gradleOpts: '--init-script /tmp/payload.gradle',
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).not.toHaveBeenCalled()
    expect(mockOutputManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused gradle options'),
      }),
      'text',
      '-',
    )
  })

  it('forwards gradle overrides from socket.json under the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          gradle: {
            bin: 'tools/gradlew',
            gradleOpts: '--info --stacktrace',
            verbose: true,
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'json',
      trustSocketJson: true,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/proj/tools/gradlew',
        gradleOpts: ['--info', '--stacktrace'],
        verbose: true,
      }),
    )
  })

  it('skips gradle when disabled in socket.json', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { gradle: { disabled: true } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToFacts).not.toHaveBeenCalled()
    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
  })

  it('does nothing when no manifests are detected', async () => {
    const result = await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToFacts).not.toHaveBeenCalled()
    expect(mockConvertGradleToFacts).not.toHaveBeenCalled()
    expect(mockConvertMavenToFacts).not.toHaveBeenCalled()
    expect(mockHandleManifestConda).not.toHaveBeenCalled()
    expect(mockRunBazelAutoManifest).not.toHaveBeenCalled()
    expect(result).toEqual({
      generatedFiles: [],
      resolvedPathsSidecar: undefined,
    })
  })
})
