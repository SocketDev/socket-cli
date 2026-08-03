/**
 * Unit tests for generateAutoManifest's conda leg.
 *
 * The conda `infile`/`outfile` defaults come from the scanned repository's
 * socket.json: `infile` is read and `outfile` is written, so a path that leaves
 * cwd is refused unless the caller opts in with the trust flag.
 *
 * Related Files:
 *
 * - Src/commands/manifest/generate_auto_manifest.mts
 * - Src/commands/manifest/manifest-build-trust.mts
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

describe('generateAutoManifest conda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadOrDefaultSocketJson.mockReturnValue({})
  })

  it('runs conda handler when conda is detected and not disabled', async () => {
    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockHandleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/proj',
        filename: 'environment.yml',
        verbose: false,
      }),
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('environment.yml'),
    )
  })

  it('forwards conda overrides from socket.json (infile/outfile/verbose)', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          conda: {
            infile: 'env.yml',
            outfile: 'reqs.txt',
            verbose: true,
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockHandleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: '/proj/env.yml',
        out: '/proj/reqs.txt',
        verbose: true,
      }),
    )
  })

  it('refuses a socket.json conda outfile that escapes cwd', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          conda: {
            outfile: '/home/user/.zshrc',
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockHandleManifestConda).not.toHaveBeenCalled()
    expect(mockOutputRequirements).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused a conda output path'),
      }),
      'text',
      '-',
    )
  })

  it('refuses a socket.json conda infile that escapes cwd', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          conda: {
            infile: '../../etc/passwd',
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockHandleManifestConda).not.toHaveBeenCalled()
    expect(mockOutputRequirements).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining('Refused a conda input path'),
      }),
      'text',
      '-',
    )
  })

  it('honors an escaping socket.json conda outfile under the trust flag', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: {
        manifest: {
          conda: {
            outfile: '/tmp/reqs.txt',
          },
        },
      },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: true,
      verbose: false,
    })

    expect(mockHandleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({
        out: '/tmp/reqs.txt',
      }),
    )
  })

  it('skips conda when disabled in socket.json', async () => {
    mockReadOrDefaultSocketJson.mockReturnValueOnce({
      defaults: { manifest: { conda: { disabled: true } } },
    })

    await generateAutoManifest({
      cwd: '/proj',
      detected: { ...baseDetected, conda: true },
      outputKind: 'text',
      trustSocketJson: false,
      verbose: false,
    })

    expect(mockHandleManifestConda).not.toHaveBeenCalled()
  })
})
