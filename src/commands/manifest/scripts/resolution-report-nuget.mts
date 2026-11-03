import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// NuGet's restore error codes, per
// https://learn.microsoft.com/en-us/nuget/reference/errors-and-warnings.
const NOT_FOUND_CODES = new Set(['NU1100', 'NU1101', 'NU1102', 'NU1103'])
// Loading a source's service index or package metadata failed; insecure
// (HTTP) sources.
const SOURCE_CODES = new Set(['NU1301', 'NU1302'])

// The socket-facts-dotnet tool reports restore errors as `<code>: <message>`,
// and a design-time build failure as `<finding>: <code>: <message>`; its
// findings without a code count as other failures.
export function classifyNugetFailure(detail: string): FailureCategory {
  const code = /(?:^|: )(NU\d{4}|NETSDK\d{4}|MSB\d{4}):/.exec(detail || '')?.[1]
  if (!code) {
    return 'other'
  }
  if (NOT_FOUND_CODES.has(code)) {
    return 'not-found'
  }
  if (SOURCE_CODES.has(code)) {
    return 'repository-or-network'
  }
  // Any other NuGet, .NET SDK or MSBuild error is about the project, the
  // lock file, central package management or framework compatibility.
  return 'config-problem'
}

export const NUGET_DIALECT: ResolutionDialect = {
  label: 'NuGet',
  classify: classifyNugetFailure,
  categories: [
    {
      key: 'not-found',
      header: () => '  Not found in any package source:',
      showReason: true,
      blocking: true,
    },
    {
      key: 'repository-or-network',
      header: n =>
        `  Package source or network error — ${n} could not reach or authenticate to a source:`,
      showReason: true,
      blocking: true,
    },
    {
      key: 'config-problem',
      header: n =>
        `  Project or restore configuration problem (reason from ${n}):`,
      showReason: true,
      blocking: true,
    },
    {
      key: 'other',
      header: n => `  Other resolution failures (reason from ${n}):`,
      showReason: true,
      blocking: true,
    },
  ],
}
