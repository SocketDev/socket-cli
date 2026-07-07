import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the helpers BEFORE importing generateAutoManifest.
vi.mock('./bazel/extract_bazel_to_maven.mts', () => ({
  extractBazelToMaven: vi.fn(async () => ({
    artifactCount: 1,
    complete: true,
    manifestPaths: ['/tmp/repo/.socket-auto-manifest/maven_install.json'],
    status: 'complete',
    workspaceOutcomes: [],
  })),
}))
vi.mock('./convert_gradle_to_maven.mts', () => ({
  convertGradleToMaven: vi.fn(async () => undefined),
}))
vi.mock('./convert_sbt_to_maven.mts', () => ({
  convertSbtToMaven: vi.fn(async () => undefined),
}))
vi.mock('./convert-dotnet-to-facts.mts', () => ({
  convertDotnetToFacts: vi.fn(async () => undefined),
}))
vi.mock('./convert-gradle-to-facts.mts', () => ({
  convertGradleToFacts: vi.fn(async () => undefined),
}))
vi.mock('./convert-sbt-to-facts.mts', () => ({
  convertSbtToFacts: vi.fn(async () => undefined),
}))
vi.mock('./handle-manifest-conda.mts', () => ({
  handleManifestConda: vi.fn(async () => undefined),
}))
vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: vi.fn(() => ({})),
}))

import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { generateAutoManifest } from './generate_auto_manifest.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

const baseDetected = {
  bazel: false,
  cdxgen: false,
  conda: false,
  count: 0,
  dotnet: false,
  gradle: false,
  maven: false,
  sbt: false,
}

describe('generateAutoManifest — bazel branch', () => {
  beforeEach(() => {
    vi.mocked(extractBazelToMaven).mockClear()
    vi.mocked(convertGradleToFacts).mockClear()
    vi.mocked(convertGradleToMaven).mockClear()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
    vi.mocked(extractBazelToMaven).mockResolvedValue({
      artifactCount: 1,
      complete: true,
      manifestPaths: ['/tmp/repo/.socket-auto-manifest/maven_install.json'],
      status: 'complete',
      workspaceOutcomes: [],
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
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([
      '/tmp/repo/.socket-auto-manifest/maven_install.json',
    ])
  })

  it('does not run PyPI by default when Maven has no discovery', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'noEcosystem',
      workspaceOutcomes: [],
    })
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([])
  })

  it('throws when Maven hard-fails', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes: [],
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

  it('does NOT throw when Maven has no discovery', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'noEcosystem',
      workspaceOutcomes: [],
    })
    const result = await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, bazel: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })

    expect(result.generatedFiles).toEqual([])
  })

  it('pushes the partial manifests and warns loudly with the incompleteness detail', async () => {
    vi.mocked(extractBazelToMaven).mockResolvedValueOnce({
      artifactCount: 2,
      complete: false,
      manifestPaths: [
        '/tmp/repo/.socket-auto-manifest/maven_install.json',
        '/tmp/repo/.socket-auto-manifest/sub/maven_install.json',
      ],
      status: 'partial',
      workspaceOutcomes: [
        {
          hubs: [{ hub: 'maven', reason: 'cquery-timeout', state: 'failed' }],
          load: 'loaded',
          relPath: 'sub',
        },
      ],
    })
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    try {
      const result = await generateAutoManifest({
        cwd: '/tmp/repo',
        detected: { ...baseDetected, bazel: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      })
      // Hybrid: the partial SBOM is still uploaded.
      expect(result.generatedFiles).toEqual([
        '/tmp/repo/.socket-auto-manifest/maven_install.json',
        '/tmp/repo/.socket-auto-manifest/sub/maven_install.json',
      ])
      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toMatch(/PARTIAL/)
      expect(warned).toMatch(/known-incomplete/)
      // The structured outcome detail surfaces the failing hub.
      expect(warned).toMatch(/sub@maven \(failed\)/)
    } finally {
      warnSpy.mockRestore()
    }
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
    // Socket facts is the default for the gradle branch.
    expect(convertGradleToFacts).toHaveBeenCalledTimes(1)
    expect(convertGradleToMaven).not.toHaveBeenCalled()
  })

  it('uses the gradle pom generator when defaults.manifest.gradle.facts is false', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { gradle: { facts: false } } },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, gradle: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    expect(convertGradleToMaven).toHaveBeenCalledTimes(1)
    expect(convertGradleToFacts).not.toHaveBeenCalled()
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

describe('generateAutoManifest — dotnet branch', () => {
  beforeEach(() => {
    vi.mocked(convertDotnetToFacts).mockClear()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
  })

  it('generates dotnet facts when detected and not disabled', async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, count: 1, dotnet: true },
      outputKind: 'text',
      verbose: false,
    })
    expect(convertDotnetToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'dotnet',
        cwd: '/tmp/repo',
        ignoreUnresolved: false,
      }),
    )
  })

  it('skips dotnet when defaults.manifest.dotnet.disabled is true', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { dotnet: { disabled: true } } },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, count: 1, dotnet: true },
      outputKind: 'text',
      verbose: false,
    })
    expect(convertDotnetToFacts).not.toHaveBeenCalled()
  })

  it('honors socket.json dotnet defaults (bin, target frameworks, ignoreUnresolved)', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          dotnet: {
            bin: '/opt/dotnet/dotnet',
            excludeTargetFrameworks: 'netstandard*',
            ignoreUnresolved: true,
            targetFrameworks: 'net8.0',
          },
        },
      },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, count: 1, dotnet: true },
      outputKind: 'text',
      verbose: false,
    })
    expect(convertDotnetToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: '/opt/dotnet/dotnet',
        excludeConfigs: 'netstandard*',
        ignoreUnresolved: true,
        includeConfigs: 'net8.0',
      }),
    )
  })
})
