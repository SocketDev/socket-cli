import { describe, expect, it } from 'vitest'

import { parseDynamicSbomInferenceFlags } from './reachability-flags.mts'

describe('parseDynamicSbomInferenceFlags', () => {
  it.for([
    { flags: {}, expected: undefined },
    { flags: { dynamicSbomInference: true }, expected: ['maven', 'nuget'] },
    {
      flags: {
        dynamicSbomInference: true,
        dynamicSbomInferenceEcosystems: ['NuGet,nuget'],
      },
      expected: ['nuget'],
    },
    {
      flags: {
        dynamicSbomInference: true,
        dynamicSbomInferenceEcosystems: ['maven', 'Maven,NUGET'],
      },
      expected: ['maven', 'nuget'],
    },
  ])('reads $flags as $expected', ({ expected, flags }) => {
    expect(parseDynamicSbomInferenceFlags(flags)).toEqual(expected)
  })

  it.for([
    {
      flags: { dynamicSbomInferenceEcosystems: ['maven'] },
      error:
        '--dynamic-sbom-inference-ecosystems requires --dynamic-sbom-inference',
    },
    {
      flags: {
        dynamicSbomInference: true,
        dynamicSbomInferenceEcosystems: ['maven,npm'],
      },
      error: 'Invalid ecosystem: "npm". Valid values are: maven and nuget',
    },
  ])('rejects $flags', ({ error, flags }) => {
    expect(() => parseDynamicSbomInferenceFlags(flags)).toThrow(error)
  })
})
