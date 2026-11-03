import { describe, expect, it } from 'vitest'

import { classifyNugetFailure } from './resolution-report-nuget.mts'

import type { FailureCategory } from './resolution-report-render.mts'

const DETAILS_BY_CATEGORY = {
  'config-problem': [
    'NU1004: The package references have changed for net8.0. Lock file is not consistent.',
    'NU1109: Detected package downgrade: Polly from 8.4.2 to centrally defined 7.2.4.',
    'NU1201: Project Fs is not compatible with netstandard2.0.',
    'NETSDK1147: To build this project, the following workloads must be installed: maui',
    "MSB4236: The SDK 'Microsoft.Build.Traversal/2.0.24' specified could not be found.",
    'could not read the solution: MSB5009: Error parsing the nested project section in solution file.',
    'could not evaluate the project: MSB4019: The imported project "/repo/x.props" was not found.  /repo/App.csproj',
  ],
  'not-found': [
    'NU1101: Unable to find package Foo. No packages exist with this id in source(s): nuget.org',
    'NU1102: Unable to find package Foo with version (>= 9.0.0)',
  ],
  other: [
    'obj/project.assets.json belongs to B.csproj: the projects share an intermediate output directory, so restore output cannot be attributed',
    'runtime assemblies restore listed are missing from the package folders (lib/net8.0/Foo.dll); re-run `dotnet restore`',
  ],
  'repository-or-network': [
    'NU1301: Unable to load the service index for source https://feed/index.json.',
    'NU1301: Unable to load the service index for source https://feed/index.json. Response status code does not indicate success: 401 (Unauthorized).',
  ],
} satisfies Partial<Record<FailureCategory, string[]>>

describe('classifyNugetFailure', () => {
  it.for(
    Object.entries(DETAILS_BY_CATEGORY).flatMap(({ 0: category, 1: details }) =>
      details.map(detail => [category, detail] as const),
    ),
  )('%s: %s', ({ 0: category, 1: detail }) => {
    expect(classifyNugetFailure(detail)).toBe(category)
  })
})
