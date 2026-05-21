import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the helpers BEFORE importing generateAutoManifest.
vi.mock('./bazel/extract_bazel_to_maven.mts', () => ({
  extractBazelToMaven: vi.fn(async () => ({
    artifactCount: 1,
    manifestPath: '/tmp/repo/.socket-auto-manifest/maven_install.json',
    ok: true,
  })),
}))
vi.mock('./bazel/extract_bazel_to_pypi.mts', () => ({
  extractBazelToPypi: vi.fn(async () => ({
    artifactCount: 0,
    ok: true,
    noEcosystemFound: true,
  })),
}))
vi.mock('./convert_gradle_to_maven.mts', () => ({
  convertGradleToMaven: vi.fn(async () => undefined),
}))
vi.mock('./convert_sbt_to_maven.mts', () => ({
  convertSbtToMaven: vi.fn(async () => undefined),
}))
vi.mock('./handle-manifest-conda.mts', () => ({
  handleManifestConda: vi.fn(async () => undefined),
}))
vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: vi.fn(() => ({})),
}))

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { extractBazelToPypi } from './bazel/extract_bazel_to_pypi.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { generateAutoManifest } from './generate_auto_manifest.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

const baseDetected = {
  bazel: false,
  cdxgen: false,
  conda: false,
  count: 0,
  gradle: false,
  sbt: false,
}

describe('generateAutoManifest — bazel branch', () => {
  beforeEach(() => {
    vi.mocked(extractBazelToMaven).mockClear()
    vi.mocked(extractBazelToPypi).mockClear()
    vi.mocked(convertGradleToMaven).mockClear()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
    vi.mocked(extractBazelToMaven).mockResolvedValue({
      artifactCount: 1,
      manifestPath: '/tmp/repo/.socket-auto-manifest/maven_install.json',
      ok: true,
    })
    vi.mocked(extractBazelToPypi).mockResolvedValue({
      artifactCount: 0,
      ok: true,
      noEcosystemFound: true,
    })
  })

  it('calls extractBazelToMaven with outLayout: "flat" and out===cwd when bazel detected and not disabled', async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).toHaveBeenCalledTimes(1)
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/repo',
        out: '/tmp/repo',
        outLayout: 'flat',
      }),
    )
  })

  it('does NOT call extractBazelToMaven when defaults.manifest.bazel.disabled is true', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { bazel: { disabled: true } } },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).not.toHaveBeenCalled()
  })

  it('plumbs bazel and bazelFlags from socket.json defaults', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          bazel: {
            bazel: '/usr/local/bin/bazelisk',
            bazelFlags: '--config=ci',
          },
        },
      },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/usr/local/bin/bazelisk',
        bazelFlags: '--config=ci',
      }),
    )
  })

  it('falls back to defaults.manifest.bazel.bin for compatibility', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          bazel: {
            bin: '/compat/bin/bazelisk',
          },
        },
      },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/compat/bin/bazelisk',
      }),
    )
  })

  it('returns generated Bazel Maven sidecar manifest by default', async () => {
    vi.mocked(extractBazelToPypi).mockResolvedValueOnce({
      artifactCount: 2,
      manifestPath: '/tmp/repo/.socket-auto-manifest/requirements.txt',
      ok: true,
    })
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([
      '/tmp/repo/.socket-auto-manifest/maven_install.json',
    ])
    expect(extractBazelToPypi).not.toHaveBeenCalled()
  })

  it('runs Bazel PyPI auto-manifest only when socket.json explicitly opts in', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: { bazel: { ecosystem: ['maven', 'pypi'] } },
      },
    } as SocketJson)
    vi.mocked(extractBazelToPypi).mockResolvedValueOnce({
      artifactCount: 2,
      manifestPath: '/tmp/repo/.socket-auto-manifest/requirements.txt',
      ok: true,
    })
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(extractBazelToPypi).toHaveBeenCalledWith(
      expect.objectContaining({ explicitEcosystem: true }),
    )
    expect(result.generatedFiles).toEqual([
      '/tmp/repo/.socket-auto-manifest/maven_install.json',
      '/tmp/repo/.socket-auto-manifest/requirements.txt',
    ])
  })

  it('does not run PyPI by default when Maven has no discovery', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      noEcosystemFound: true,
      ok: false,
    })
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([])
    expect(extractBazelToPypi).not.toHaveBeenCalled()
  })

  it('throws when Maven hard-fails even if PyPI succeeds', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      ok: false,
    })
    await expect(
      generateAutoManifest({
        cwd: '/tmp/repo',
        detected: { ...baseDetected, bazel: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      }),
    ).rejects.toThrow(
      'Bazel auto-manifest generation failed for ecosystem(s): maven',
    )
  })

  it('does NOT throw when both ecosystems have no discovery', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      noEcosystemFound: true,
      ok: false,
    })
    vi.mocked(extractBazelToPypi).mockResolvedValueOnce({
      artifactCount: 0,
      ok: true,
      noEcosystemFound: true,
    })

    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([])
    expect(extractBazelToPypi).not.toHaveBeenCalled()
  })

  it('runs BOTH bazel and gradle branches when both are detected', async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: {
        ...baseDetected,
        bazel: true,
        gradle: true,
        count: 2,
      },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).toHaveBeenCalledTimes(1)
    expect(convertGradleToMaven).toHaveBeenCalledTimes(1)
  })

  it('honors socket.json out override (user-supplied .socket-auto-manifest dir)', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: { bazel: { out: './.socket-auto-manifest' } },
      },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({
        out: './.socket-auto-manifest',
        outLayout: 'flat',
      }),
    )
  })
})
