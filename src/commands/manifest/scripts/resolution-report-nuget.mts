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

// The socket-facts-dotnet tool reports restore errors as `<code>: <message>`
// and its own findings as plain sentences.
export function classifyNugetFailure(detail: string): FailureCategory {
  const text = detail || ''
  const code = /^(NU\d{4}|NETSDK\d{4}|MSB\d{4})\b/.exec(text)?.[1]
  if (code && NOT_FOUND_CODES.has(code)) {
    return 'not-found'
  }
  const t = text.toLowerCase()
  if (
    (code && SOURCE_CODES.has(code)) ||
    t.includes('unable to load the service index') ||
    t.includes('response status code does not indicate success') ||
    t.includes('401 (unauthorized)') ||
    t.includes('403 (forbidden)')
  ) {
    return 'repository-or-network'
  }
  // Any other NuGet, .NET SDK or MSBuild error is about the project, the
  // lock file, central package management or framework compatibility.
  if (
    code ||
    t.startsWith('could not evaluate') ||
    t.startsWith('could not read') ||
    t.startsWith('the design-time build failed') ||
    t.includes('share an intermediate output directory') ||
    t.startsWith('project.json projects are not supported')
  ) {
    return 'config-problem'
  }
  return 'other'
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
