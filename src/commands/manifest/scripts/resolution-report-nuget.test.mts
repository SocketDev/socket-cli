import { describe, expect, it } from 'vitest'

import { classifyNugetFailure } from './resolution-report-nuget.mts'

describe('classifyNugetFailure', () => {
  it.each([
    [
      'NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org',
      'not-found',
    ],
    ['NU1102: Unable to find package Foo with version (>= 9.0.0)', 'not-found'],
    [
      'NU1301: Unable to load the service index for source https://feed/index.json.',
      'repository-or-network',
    ],
    [
      'Response status code does not indicate success: 401 (Unauthorized).',
      'repository-or-network',
    ],
    [
      'NU1004: The package references have changed for net8.0. Lock file is not consistent.',
      'config-problem',
    ],
    [
      'NU1109: Detected package downgrade: Polly from 8.4.2 to centrally defined 7.2.4.',
      'config-problem',
    ],
    [
      'NU1201: Project Fs is not compatible with netstandard2.0.',
      'config-problem',
    ],
    [
      'NETSDK1147: To build this project, the following workloads must be installed: maui',
      'config-problem',
    ],
    [
      'could not evaluate the project: The imported project "x.props" was not found.',
      'config-problem',
    ],
    [
      'the design-time build failed: MSB3644: The reference assemblies for .NETFramework,Version=v4.8 were not found.',
      'config-problem',
    ],
    [
      'obj/project.assets.json belongs to B.csproj: the projects share an intermediate output directory, so restore output cannot be attributed',
      'config-problem',
    ],
    [
      'runtime assemblies restore listed are missing from the package folders (lib/net8.0/Foo.dll); re-run `dotnet restore`',
      'other',
    ],
  ])('%s', (detail, category) => {
    expect(classifyNugetFailure(detail)).toBe(category)
  })
})
