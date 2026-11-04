import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDynamicSbomInference } from './run-dynamic-sbom-inference.mts'

const { mockGenerateRecursiveManifests, mockWarn } = vi.hoisted(() => ({
  mockGenerateRecursiveManifests: vi.fn(),
  mockWarn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: { warn: mockWarn },
}))

vi.mock('../manifest/generate-recursive-manifests.mts', () => ({
  generateRecursiveManifests: mockGenerateRecursiveManifests,
}))

const generated = {
  dir: '/repo/a',
  ecosystem: 'maven',
  factsPath: '/repo/a/.socket.facts.json',
  status: 'generated',
}

describe('runDynamicSbomInference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only the generated facts paths, ignoring empty and skipped roots', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'gradle', status: 'empty' },
      { dir: '/repo/c', ecosystem: 'sbt', status: 'skippedDisabled' },
      { dir: '/repo/d', ecosystem: 'maven', status: 'skippedCovered' },
    ])

    const result = await runDynamicSbomInference({
      consumer: undefined,
      cwd: '/repo',
      excludePaths: ['vendor/**'],
      sbtTmpDir: '/tmp/sbt',
    })

    expect(result).toEqual({
      factsOnlyTypes: ['maven'],
      factsPaths: ['/repo/a/.socket.facts.json'],
      resolvedPathsSidecar: undefined,
    })
    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith({
      cwd: '/repo',
      excludePaths: ['vendor/**'],
      requireDotnetSdk: false,
      // Only meaningful for reach; withheld otherwise so the callee
      // allocates and cleans up its own ephemeral base.
      sbtTmpDir: undefined,
      sidecarAcc: undefined,
      verbose: false,
      withFiles: false,
    })
  })

  it('accumulates and serializes a sidecar for reachability', async () => {
    mockGenerateRecursiveManifests.mockImplementationOnce(
      async ({ sidecarAcc }) => {
        sidecarAcc.set('/repo/a/.socket.facts.json', {
          projects: [{ name: 'app' }],
          components: [],
        })
        return [generated]
      },
    )

    const result = await runDynamicSbomInference({
      consumer: 'reach',
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: '/tmp/sbt',
    })

    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({
        requireDotnetSdk: true,
        sbtTmpDir: '/tmp/sbt',
        withFiles: true,
      }),
    )
    expect(result.resolvedPathsSidecar).toEqual({
      '/repo/a/.socket.facts.json': {
        projects: [{ name: 'app' }],
        components: [],
      },
    })
  })

  it('collects a sidecar for fix without resolving artifact paths', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([generated])

    await runDynamicSbomInference({
      consumer: 'fix',
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: undefined,
    })

    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({
        requireDotnetSdk: true,
        sidecarAcc: expect.any(Map),
        withFiles: false,
      }),
    )
  })

  it('throws when no build root was discovered at all', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([])

    await expect(
      runDynamicSbomInference({
        consumer: 'reach',
        cwd: '/repo',
        excludePaths: [],
        sbtTmpDir: undefined,
      }),
    ).rejects.toThrow(/No Gradle, sbt, Maven or .NET build root was found/)
  })

  it('throws when a discovered build root failed to generate facts', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'maven', status: 'failed' },
    ])

    await expect(
      runDynamicSbomInference({
        consumer: 'reach',
        cwd: '/repo',
        excludePaths: [],
        sbtTmpDir: undefined,
      }),
    ).rejects.toThrow(/one or more independent build roots failed/i)
  })

  it('makes every discovered ecosystem facts-only, generated or not', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'dotnet', status: 'skippedDisabled' },
      { dir: '/repo/c', ecosystem: 'sbt', status: 'empty' },
    ])

    const result = await runDynamicSbomInference({
      consumer: 'reach',
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: undefined,
    })

    expect(result.factsOnlyTypes.sort()).toEqual(['maven', 'nuget'])
  })

  it('throws for reachability when no build root produced facts', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      { dir: '/repo/a', ecosystem: 'maven', status: 'empty' },
      { dir: '/repo/b', ecosystem: 'gradle', status: 'skippedDisabled' },
    ])

    await expect(
      runDynamicSbomInference({
        consumer: 'reach',
        cwd: '/repo',
        excludePaths: [],
        sbtTmpDir: undefined,
      }),
    ).rejects.toThrow(/Re-enable the builds/)
  })

  it('lets fix proceed when no build root produced facts', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      { dir: '/repo/a', ecosystem: 'maven', status: 'empty' },
    ])

    const result = await runDynamicSbomInference({
      consumer: 'fix',
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: undefined,
    })

    expect(result.factsPaths).toEqual([])
  })

  it('warns that build roots socket.json skips are left out', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'maven', status: 'skippedDisabled' },
    ])

    await runDynamicSbomInference({
      consumer: 'reach',
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: undefined,
    })

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringMatching(/leaves out the build roots socket.json skips/),
    )
  })

  it('neither throws nor warns for roots without facts when Coana does not consume them', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      { dir: '/repo/a', ecosystem: 'maven', status: 'skippedDisabled' },
    ])

    const result = await runDynamicSbomInference({
      consumer: undefined,
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: undefined,
    })

    expect(result.factsPaths).toEqual([])
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
