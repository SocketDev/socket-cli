import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDynamicSbomInference } from './run-dynamic-sbom-inference.mts'

import type { FactsConsumer } from './run-dynamic-sbom-inference.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'

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

function run(
  consumer: FactsConsumer,
  purlTypes: readonly PURL_Type[] = ['maven', 'nuget'],
) {
  return runDynamicSbomInference({
    consumer,
    cwd: '/repo',
    excludePaths: ['vendor/**'],
    purlTypes,
    sbtTmpDir: '/tmp/sbt',
  })
}

describe('runDynamicSbomInference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.for([
    // sbtTmpDir only matters for reach; withheld otherwise so the callee
    // allocates and cleans up its own ephemeral base.
    {
      consumer: 'upload',
      sbtTmpDir: undefined,
      sidecar: false,
      withFiles: false,
    },
    {
      consumer: 'fix',
      sbtTmpDir: undefined,
      sidecar: true,
      withFiles: false,
    },
    {
      consumer: 'reach',
      sbtTmpDir: '/tmp/sbt',
      sidecar: true,
      withFiles: true,
    },
  ] as const)(
    'generates for $consumer',
    async ({ consumer, sbtTmpDir, sidecar, withFiles }) => {
      mockGenerateRecursiveManifests.mockResolvedValueOnce([generated])

      await run(consumer)

      expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith({
        cwd: '/repo',
        excludePaths: ['vendor/**'],
        purlTypes: ['maven', 'nuget'],
        sbtTmpDir,
        sidecarAcc: sidecar ? expect.any(Map) : undefined,
        verbose: false,
        withFiles,
      })
    },
  )

  it('returns only the generated facts paths, ignoring empty and skipped roots', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'gradle', status: 'empty' },
      { dir: '/repo/c', ecosystem: 'sbt', status: 'skippedDisabled' },
      { dir: '/repo/d', ecosystem: 'maven', status: 'skippedCovered' },
    ])

    expect(await run('upload')).toEqual({
      factsOnlyTypes: ['maven'],
      factsPaths: ['/repo/a/.socket.facts.json'],
      resolvedPathsSidecar: undefined,
    })
  })

  it('serializes the accumulated sidecar', async () => {
    mockGenerateRecursiveManifests.mockImplementationOnce(
      async ({ sidecarAcc }) => {
        sidecarAcc.set('/repo/a/.socket.facts.json', {
          projects: [{ name: 'app' }],
          components: [],
        })
        return [generated]
      },
    )

    expect((await run('reach')).resolvedPathsSidecar).toEqual({
      '/repo/a/.socket.facts.json': {
        projects: [{ name: 'app' }],
        components: [],
      },
    })
  })

  it('makes every discovered ecosystem facts-only, generated or not', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'dotnet', status: 'skippedDisabled' },
      { dir: '/repo/c', ecosystem: 'sbt', status: 'empty' },
    ])

    expect((await run('reach')).factsOnlyTypes.sort()).toEqual([
      'maven',
      'nuget',
    ])
  })

  it.for([
    {
      name: 'no build root was discovered',
      outcomes: [],
      error: /No Gradle, sbt, Maven or .NET build root was found/,
    },
    {
      name: 'a discovered build root failed to generate facts',
      outcomes: [
        generated,
        { dir: '/repo/b', ecosystem: 'maven', status: 'failed' },
      ],
      error: /one or more independent build roots failed/i,
    },
    {
      name: 'no build root produced facts for reachability',
      outcomes: [
        { dir: '/repo/a', ecosystem: 'maven', status: 'empty' },
        { dir: '/repo/b', ecosystem: 'gradle', status: 'skippedDisabled' },
      ],
      error: /Re-enable the builds that socket.json skips/,
    },
  ])('throws when $name', async ({ error, outcomes }) => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce(outcomes)

    await expect(run('reach')).rejects.toThrow(error)
  })

  it.for([
    {
      name: 'no build root of the selected ecosystems was found',
      outcomes: [],
      error: /No build root for nuget was found/,
    },
    {
      name: 'the selected ecosystems produced no facts',
      outcomes: [{ dir: '/repo/a', ecosystem: 'dotnet', status: 'empty' }],
      error: /select other ecosystems with --dynamic-sbom-inference-ecosystems/,
    },
  ])('names the selection when $name', async ({ error, outcomes }) => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce(outcomes)

    await expect(run('reach', ['nuget'])).rejects.toThrow(error)
    expect(mockGenerateRecursiveManifests).toHaveBeenCalledWith(
      expect.objectContaining({ purlTypes: ['nuget'] }),
    )
  })

  it.for([
    {
      consumer: 'fix',
      outcomes: [{ dir: '/repo/a', ecosystem: 'maven', status: 'empty' }],
    },
    // Without Coana, the roots socket.json skips are not left out of anything.
    {
      consumer: 'upload',
      outcomes: [
        { dir: '/repo/a', ecosystem: 'maven', status: 'skippedDisabled' },
      ],
    },
  ] as const)(
    'lets $consumer proceed quietly without facts',
    async ({ consumer, outcomes }) => {
      mockGenerateRecursiveManifests.mockResolvedValueOnce(outcomes)

      expect((await run(consumer)).factsPaths).toEqual([])
      expect(mockWarn).not.toHaveBeenCalled()
    },
  )

  it('warns that build roots socket.json skips are left out', async () => {
    mockGenerateRecursiveManifests.mockResolvedValueOnce([
      generated,
      { dir: '/repo/b', ecosystem: 'maven', status: 'skippedDisabled' },
    ])

    await run('reach')

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringMatching(/leaves out the build roots socket.json skips/),
    )
  })
})
