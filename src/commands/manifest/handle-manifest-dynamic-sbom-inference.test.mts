import { describe, expect, it, vi } from 'vitest'

const {
  mockGenerateRecursiveManifests,
  mockOutputManifestDynamicSbomInference,
} = vi.hoisted(() => ({
  mockGenerateRecursiveManifests: vi.fn(),
  mockOutputManifestDynamicSbomInference: vi.fn(),
}))

vi.mock('./generate-recursive-manifests.mts', () => ({
  generateRecursiveManifests: mockGenerateRecursiveManifests,
}))

vi.mock('./output-manifest-dynamic-sbom-inference.mts', () => ({
  outputManifestDynamicSbomInference: mockOutputManifestDynamicSbomInference,
}))

import { handleManifestDynamicSbomInference } from './handle-manifest-dynamic-sbom-inference.mts'

describe('handleManifestDynamicSbomInference', () => {
  it('fails closed when no build root is found anywhere', async () => {
    mockGenerateRecursiveManifests.mockResolvedValue([])

    await handleManifestDynamicSbomInference({
      cwd: '/repo',
      excludePaths: [],
      outputKind: 'text',
      verbose: false,
    })

    expect(mockOutputManifestDynamicSbomInference).toHaveBeenCalledWith(
      {
        ok: false,
        code: 1,
        message:
          'No Gradle, sbt, or Maven build root was found beneath the given directory.',
        data: [],
      },
      'text',
    )
  })

  it('fails when one or more discovered build roots failed to generate facts', async () => {
    const outcomes = [
      {
        dir: '/repo/service-a',
        ecosystem: 'maven',
        factsPath: '/repo/service-a/.socket.facts.json',
        status: 'generated',
      },
      { dir: '/repo/service-b', ecosystem: 'maven', status: 'failed' },
    ]
    mockGenerateRecursiveManifests.mockResolvedValue(outcomes)

    await handleManifestDynamicSbomInference({
      cwd: '/repo',
      excludePaths: [],
      outputKind: 'text',
      verbose: false,
    })

    expect(mockOutputManifestDynamicSbomInference).toHaveBeenCalledWith(
      {
        ok: false,
        code: 1,
        message: 'One or more build roots failed to generate Socket facts.',
        data: outcomes,
      },
      'text',
    )
  })

  it('succeeds when every discovered build root generated facts', async () => {
    const outcomes = [
      {
        dir: '/repo/service-a',
        ecosystem: 'maven',
        factsPath: '/repo/service-a/.socket.facts.json',
        status: 'generated',
      },
    ]
    mockGenerateRecursiveManifests.mockResolvedValue(outcomes)

    await handleManifestDynamicSbomInference({
      cwd: '/repo',
      excludePaths: [],
      outputKind: 'json',
      verbose: false,
    })

    expect(mockOutputManifestDynamicSbomInference).toHaveBeenCalledWith(
      { ok: true, data: outcomes },
      'json',
    )
  })
})
