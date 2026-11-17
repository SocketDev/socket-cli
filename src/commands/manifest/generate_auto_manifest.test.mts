import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
vi.mock('./run-manifest-facts.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('./run-manifest-facts.mts')>()),
  runManifestFacts: vi.fn(async () => undefined),
}))
vi.mock('./handle-manifest-conda.mts', () => ({
  handleManifestConda: vi.fn(async () => undefined),
}))
vi.mock('../../utils/socket-json.mts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/socket-json.mts')>()),
  readOrDefaultSocketJson: vi.fn(() => ({})),
}))

import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { generateAutoManifest } from './generate_auto_manifest.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import { runManifestFacts } from './run-manifest-facts.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

const baseDetected = {
  bazel: false,
  cdxgen: false,
  conda: false,
  condaFile: '',
  count: 0,
  dotnet: false,
  gradle: false,
  maven: false,
  sbt: false,
}

describe('generateAutoManifest — bazel branch', () => {
  beforeEach(() => {
    vi.mocked(extractBazelToMaven).mockClear()
    vi.mocked(runManifestFacts).mockClear()
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
    expect(runManifestFacts).toHaveBeenCalledTimes(1)
    expect(convertGradleToMaven).not.toHaveBeenCalled()
  })

  it.for([['--exclude-paths'], [undefined]] as const)(
    'names the exclude-paths flag %s in remedies only when the command takes one',
    async ({ 0: excludePathsFlag }) => {
      await generateAutoManifest({
        cwd: '/tmp/repo',
        detected: { ...baseDetected, maven: true, count: 1 },
        excludePathsFlag,
        outputKind: 'text',
        verbose: false,
      })
      expect(vi.mocked(runManifestFacts).mock.calls[0]?.[0].hints).toEqual(
        expect.objectContaining({ excludePathsFlag }),
      )
    },
  )

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
    expect(runManifestFacts).not.toHaveBeenCalled()
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

function callFor(ecosystem: string) {
  return vi
    .mocked(runManifestFacts)
    .mock.calls.find(([opts]) => opts.ecosystem === ecosystem)?.[0]
}

describe('generateAutoManifest — JVM facts', () => {
  beforeEach(() => {
    vi.mocked(runManifestFacts).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
  })

  it("builds a Maven root's pom.xml by name, apart from a Gradle build beside it", async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, gradle: true, maven: true, count: 2 },
      outputKind: 'text',
      verbose: false,
    })
    expect(callFor('maven')).toMatchObject({
      cwd: '/tmp/repo',
      entryFile: 'pom.xml',
    })
    expect(callFor('gradle')).toMatchObject({ cwd: '/tmp/repo' })
    expect(callFor('gradle')?.entryFile).toBeUndefined()
  })

  it('takes each JVM build tool its socket.json section as the walk does', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          gradle: {
            excludeConfigs: 'test*',
            gradleOpts: '--offline',
            ignoreUnresolved: true,
            javaHome: '$GRADLE_JDK',
          },
          maven: { bin: 'mvn', includeConfigs: 'compile', verbose: true },
          sbt: { sbtOpts: '-Dx=1' },
        },
      },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: { ...baseDetected, gradle: true, maven: true, sbt: true },
      excludePaths: ['docs/**'],
      outputKind: 'text',
      verbose: false,
    })
    expect(callFor('gradle')).toMatchObject({
      buildOpts: ['--offline'],
      excludeBase: '/tmp/repo',
      excludeConfigs: 'test*',
      excludePaths: ['docs/**'],
      ignoreUnresolved: true,
      javaHome: '$GRADLE_JDK',
    })
    expect(callFor('maven')).toMatchObject({
      bin: 'mvn',
      includeConfigs: 'compile',
      verbose: true,
    })
    expect(callFor('sbt')).toMatchObject({ bin: 'sbt', buildOpts: ['-Dx=1'] })
  })

  it.for([
    ['--file sub/app.xml', 'sub', 'app.xml'],
    ['-fsub/app.xml', 'sub', 'app.xml'],
    ['--file=sub', 'sub', 'pom.xml'],
    ['-f sub -f other.xml', 'sub', 'pom.xml'],
  ] as const)(
    'builds the POM `%s` in mavenOpts names, keeping it out of the build options',
    async ({ 0: fileOpts, 1: dir, 2: entryFile }) => {
      const cwd = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), 'auto-manifest-file-')),
      )
      try {
        await fs.mkdir(path.join(cwd, 'sub'))
        vi.mocked(readOrDefaultSocketJson).mockReturnValue({
          defaults: {
            manifest: { maven: { bin: 'mvn', mavenOpts: `-Pci ${fileOpts}` } },
          },
        } as SocketJson)
        await generateAutoManifest({
          cwd,
          detected: { ...baseDetected, maven: true, count: 1 },
          outputKind: 'text',
          verbose: false,
        })
        expect(callFor('maven')).toMatchObject({
          buildOpts: ['-Pci'],
          cwd: path.join(cwd, dir),
          entryFile,
          excludeBase: cwd,
        })
      } finally {
        await fs.rm(cwd, { recursive: true, force: true })
      }
    },
  )

  it('runs a relative bin from the scan root when --file moves Maven into another directory', async () => {
    const cwd = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'auto-manifest-bin-')),
    )
    try {
      await fs.mkdir(path.join(cwd, 'sub'))
      vi.mocked(readOrDefaultSocketJson).mockReturnValue({
        defaults: {
          manifest: { maven: { bin: './mvnw', mavenOpts: '-f sub' } },
        },
      } as SocketJson)
      await generateAutoManifest({
        cwd,
        detected: { ...baseDetected, maven: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      })
      expect(callFor('maven')).toMatchObject({
        bin: path.join(cwd, 'mvnw'),
        cwd: path.join(cwd, 'sub'),
      })
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it("sends each tool's reachability settings on a reachability scan only", async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          dotnet: { reachability: { runtimeVersion: '8.0' } },
          gradle: { reachability: { build: 'compile' } },
          maven: { bin: 'mvn', reachability: { javaHome: '$MAVEN_JDK' } },
          sbt: { reachability: { build: 'none', javaHome: null } },
        },
      },
    } as SocketJson)
    const detected = {
      ...baseDetected,
      dotnet: true,
      gradle: true,
      maven: true,
      sbt: true,
    }
    const workDir = { dir: '/w', entries: new Map(), withFiles: true }
    await generateAutoManifest({
      context: { workDir },
      cwd: '/tmp/repo',
      detected,
      outputKind: 'text',
      verbose: false,
    })
    expect(
      Object.fromEntries(
        vi
          .mocked(runManifestFacts)
          .mock.calls.map(([opts]) => [opts.ecosystem, opts.reachability]),
      ),
    ).toEqual({
      gradle: { build: 'compile' },
      maven: { javaHome: '$MAVEN_JDK' },
      sbt: { build: 'none' },
    })
    expect(vi.mocked(convertDotnetToFacts).mock.calls[0]?.[0]).toMatchObject({
      reachability: { runtimeVersion: '8.0' },
    })

    vi.mocked(runManifestFacts).mockClear()
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected,
      outputKind: 'text',
      verbose: false,
    })
    expect(
      vi.mocked(runManifestFacts).mock.calls.map(([opts]) => opts.reachability),
    ).toEqual([undefined, undefined, undefined])
  })

  it("fails a reachability scan on an invalid setting of a detected tool, before any build, not of another's", async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: { dotnet: { reachability: { javaHome: '/jdk' } } },
      },
    } as SocketJson)
    const context = {
      workDir: { dir: '/w', entries: new Map(), withFiles: true },
    }
    await generateAutoManifest({
      context,
      cwd: '/tmp/repo',
      detected: { ...baseDetected, gradle: true, count: 1 },
      outputKind: 'text',
      verbose: false,
    })
    vi.mocked(runManifestFacts).mockClear()
    await expect(
      generateAutoManifest({
        context,
        cwd: '/tmp/repo',
        detected: { ...baseDetected, dotnet: true, gradle: true, count: 2 },
        outputKind: 'text',
        verbose: false,
      }),
    ).rejects.toThrow(
      /dotnet\.reachability\.javaHome` in .* is not a reachability setting of dotnet builds/,
    )
    expect(runManifestFacts).not.toHaveBeenCalled()
  })

  it('does not check the settings of a tool that generates pom files', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          gradle: { facts: false, reachability: { runtimeVersion: '8.0' } },
        },
      },
    } as SocketJson)

    await expect(
      generateAutoManifest({
        context: {
          workDir: { dir: '/w', entries: new Map(), withFiles: true },
        },
        cwd: '/tmp/repo',
        detected: { ...baseDetected, gradle: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      }),
    ).resolves.toBeDefined()
  })

  it('places the facts of each build it generates, with its sidecar entry', async () => {
    const cwd = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'auto-manifest-keep-')),
    )
    try {
      const stateDir = path.join(cwd, 'work', 'state')
      const factsPath = path.join(stateDir, 'pom.xml.socket.facts.json')
      const targetPath = path.join(cwd, 'pom.xml.socket.facts.json')
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(factsPath, 'generated')
      const sidecarEntry = { factsFile: targetPath, stateDir }
      vi.mocked(runManifestFacts).mockResolvedValue({
        factsPath,
        projects: [],
        sidecarEntry,
        targetPath,
      })
      const workDir = {
        dir: path.join(cwd, 'work'),
        entries: new Map(),
        withFiles: true,
      }
      await generateAutoManifest({
        context: { workDir },
        cwd,
        detected: { ...baseDetected, maven: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      })
      expect(existsSync(targetPath)).toBe(true)
      expect(await fs.readFile(targetPath, 'utf8')).toBe('generated')
      expect([...workDir.entries]).toEqual([[targetPath, sidecarEntry]])
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('generateAutoManifest — conda branch', () => {
  beforeEach(() => {
    vi.mocked(handleManifestConda).mockClear()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
    process.exitCode = undefined
  })

  it('reads the detected environment.yaml rather than the .yml default', async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: {
        ...baseDetected,
        conda: true,
        condaFile: 'environment.yaml',
        count: 1,
      },
      outputKind: 'text',
      verbose: false,
    })
    expect(handleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'environment.yaml' }),
    )
  })

  it('reads the detected environment.yml', async () => {
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: {
        ...baseDetected,
        conda: true,
        condaFile: 'environment.yml',
        count: 1,
      },
      outputKind: 'text',
      verbose: false,
    })
    expect(handleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'environment.yml' }),
    )
  })

  it('lets a socket.json infile win over the detected file', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { conda: { infile: 'conda-env.yml' } } },
    } as SocketJson)
    await generateAutoManifest({
      cwd: '/tmp/repo',
      detected: {
        ...baseDetected,
        conda: true,
        condaFile: 'environment.yaml',
        count: 1,
      },
      outputKind: 'text',
      verbose: false,
    })
    expect(handleManifestConda).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'conda-env.yml' }),
    )
  })

  it('aborts the run when the conda generator fails', async () => {
    vi.mocked(handleManifestConda).mockImplementationOnce(async () => {
      process.exitCode = 1
    })
    await expect(
      generateAutoManifest({
        cwd: '/tmp/repo',
        detected: {
          ...baseDetected,
          conda: true,
          condaFile: 'environment.yaml',
          count: 1,
        },
        outputKind: 'text',
        verbose: false,
      }),
    ).rejects.toThrow(/Auto-manifest generation failed for the conda project/)
    process.exitCode = undefined
  })

  it('aborts on a failed facts generator even when the exit code was already set', async () => {
    process.exitCode = 1
    vi.mocked(runManifestFacts).mockResolvedValueOnce(null)
    await expect(
      generateAutoManifest({
        cwd: '/tmp/repo',
        detected: { ...baseDetected, gradle: true, count: 1 },
        outputKind: 'text',
        verbose: false,
      }),
    ).rejects.toThrow(/Auto-manifest generation failed for the gradle project/)
    process.exitCode = undefined
  })
})

function generateForDotnet() {
  return generateAutoManifest({
    cwd: '/tmp/repo',
    detected: { ...baseDetected, dotnet: true, count: 1 },
    outputKind: 'text',
    verbose: false,
  })
}

describe('generateAutoManifest — dotnet branch', () => {
  beforeEach(() => {
    vi.mocked(convertDotnetToFacts).mockClear()
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
  })

  it('generates facts with the socket.json dotnet defaults', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: {
        manifest: {
          dotnet: {
            bin: '/opt/dotnet/dotnet',
            dotnetOpts: '-p:Configuration=Release',
            includeConfigs: 'net8.0',
            ignoreUnresolved: true,
          },
        },
      },
    } as SocketJson)
    await generateForDotnet()
    expect(convertDotnetToFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          bin: '/opt/dotnet/dotnet',
          buildOpts: ['-p:Configuration=Release'],
          ignoreUnresolved: true,
          includeConfigs: 'net8.0',
        }),
        cwd: '/tmp/repo',
      }),
    )
  })

  it('does not run when defaults.manifest.dotnet.disabled is true', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { dotnet: { disabled: true } } },
    } as SocketJson)
    await generateForDotnet()
    expect(convertDotnetToFacts).not.toHaveBeenCalled()
  })

  it('aborts the run when the facts generator fails', async () => {
    vi.mocked(convertDotnetToFacts).mockResolvedValueOnce(null)
    await expect(generateForDotnet()).rejects.toThrow(
      /Auto-manifest generation failed for the dotnet project/,
    )
  })
})
