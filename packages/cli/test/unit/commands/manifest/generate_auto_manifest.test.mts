/**
 * Unit tests for generateAutoManifest.
 *
 * Drives the auto-detected manifest pipeline. Each detected ecosystem (sbt,
 * gradle, conda) calls its converter unless the corresponding socket.json
 * `defaults.manifest.<x>.disabled` flag is true. All converters and the
 * socket.json reader are mocked.
 *
 * Related Files:
 *
 * - Src/commands/manifest/generate_auto_manifest.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConvertSbtToMaven = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockConvertGradleToMaven = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockHandleManifestConda = vi.hoisted(() => vi.fn().mockResolvedValue({}))
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
  import('../../../../src/commands/manifest/convert-sbt-to-maven.mts'),
  () => ({
    convertSbtToMaven: mockConvertSbtToMaven,
  }),
)
vi.mock(
  import('../../../../src/commands/manifest/convert-gradle-to-maven.mts'),
  () => ({
    convertGradleToMaven: mockConvertGradleToMaven,
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
  conda: false,
  gradle: false,
  sbt: false,
}

describe('generateAutoManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadOrDefaultSocketJson.mockReturnValue({})
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

  it('runs sbt converter when sbt is detected and not disabled', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, sbt: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'sbt',
        cwd: '/proj',
        out: './socket.sbt.pom.xml',
        sbtOpts: [],
      }),
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Scala sbt build'),
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

    expect(mockConvertSbtToMaven).toHaveBeenCalled()
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

    expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
  })

  it('refuses a socket.json sbt bin and opts without the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          sbt: {
            bin: '/custom/sbt',
            outfile: 'custom-pom.xml',
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
            outfile: 'custom-pom.xml',
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

    expect(mockConvertSbtToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/custom/sbt',
        out: 'custom-pom.xml',
        sbtOpts: ['--debug', '--noisy'],
        verbose: true,
      }),
    )
  })

  it('runs gradle converter when gradle is detected and not disabled', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, gradle: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: expect.stringContaining('gradlew'),
        cwd: '/proj',
        gradleOpts: [],
        verbose: false,
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

    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
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

    expect(mockConvertGradleToMaven).toHaveBeenCalledWith(
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

    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
  })

  it('does nothing when no manifests are detected', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockConvertSbtToMaven).not.toHaveBeenCalled()
    expect(mockConvertGradleToMaven).not.toHaveBeenCalled()
    expect(mockHandleManifestConda).not.toHaveBeenCalled()
  })
})
