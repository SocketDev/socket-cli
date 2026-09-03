import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDynamicSbomInference } from './run-dynamic-sbom-inference.mts'

const { mockGenerateRecursiveManifests } = vi.hoisted(() => ({
  mockGenerateRecursiveManifests: vi.fn(),
}))

vi.mock('../manifest/generate-recursive-manifests.mts', () => ({
  generateRecursiveManifests: mockGenerateRecursiveManifests,
}))

describe('runDynamicSbomInference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only the generated facts paths, ignoring empty and skipped roots', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      {
        dir: '/repo/a',
        ecosystem: 'maven',
        factsPath: '/repo/a/.socket.facts.json',
        status: 'generated',
      },
      { dir: '/repo/b', ecosystem: 'gradle', status: 'empty' },
      { dir: '/repo/c', ecosystem: 'sbt', status: 'skippedDisabled' },
      { dir: '/repo/d', ecosystem: 'maven', status: 'skippedCovered' },
    ])

    const result = await runDynamicSbomInference({
      cwd: '/repo',
      excludePaths: ['vendor/**'],
      sbtTmpDir: '/tmp/sbt',
      withFiles: false,
    })

    expect(result).toEqual({
      factsPaths: ['/repo/a/.socket.facts.json'],
      resolvedPathsSidecar: undefined,
    })
    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith({
      cwd: '/repo',
      excludePaths: ['vendor/**'],
      // Only meaningful with withFiles; withheld otherwise so the callee
      // allocates and cleans up its own ephemeral base.
      sbtTmpDir: undefined,
      sidecarAcc: undefined,
      verbose: false,
      withFiles: false,
    })
  })

  it('accumulates and serializes a sidecar when running with files', async () => {
    mockGenerateRecursiveManifests.mockImplementationOnce(
      async ({ sidecarAcc }) => {
        sidecarAcc.set('/repo/a/.socket.facts.json', {
          projects: [{ name: 'app' }],
          components: [],
        })
        return [
          {
            dir: '/repo/a',
            ecosystem: 'maven',
            factsPath: '/repo/a/.socket.facts.json',
            status: 'generated',
          },
        ]
      },
    )

    const result = await runDynamicSbomInference({
      cwd: '/repo',
      excludePaths: [],
      sbtTmpDir: '/tmp/sbt',
      withFiles: true,
    })

    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({ sbtTmpDir: '/tmp/sbt', withFiles: true }),
    )
    expect(result.resolvedPathsSidecar).toEqual({
      '/repo/a/.socket.facts.json': {
        projects: [{ name: 'app' }],
        components: [],
      },
    })
  })

  it('throws when no build root was discovered at all', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([])

    await expect(
      runDynamicSbomInference({
        cwd: '/repo',
        excludePaths: [],
        sbtTmpDir: undefined,
        withFiles: true,
      }),
    ).rejects.toThrow(/No Gradle, sbt, or Maven build root was found/)
  })

  it('throws when a discovered build root failed to generate facts', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      {
        dir: '/repo/a',
        ecosystem: 'maven',
        factsPath: '/repo/a/.socket.facts.json',
        status: 'generated',
      },
      { dir: '/repo/b', ecosystem: 'maven', status: 'failed' },
    ])

    await expect(
      runDynamicSbomInference({
        cwd: '/repo',
        excludePaths: [],
        sbtTmpDir: undefined,
        withFiles: true,
      }),
    ).rejects.toThrow(/one or more independent build roots failed/i)
  })
})
