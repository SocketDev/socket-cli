import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// NuGet restore: failures come from the assets file's `logs` section, whose
// messages carry NU-prefixed codes, plus the producer's synthetic
// missing-assets-file failure. No variant ambiguity, so every kind blocks.
export function classifyNugetFailure(detail: string): FailureCategory {
  const t = (detail || '').toLowerCase()
  // Assembly-load/runtime failures inside the tool are environment problems,
  // not feed problems — check FIRST: NuGet wraps them in NU1301-style messages
  // whose wording would otherwise classify as repository-or-network and send
  // users chasing connectivity. showReason on config-problem surfaces the
  // real loader message in the summary.
  if (
    t.includes('could not load file or assembly') ||
    t.includes('missingmethodexception') ||
    t.includes('0x80131040')
  ) {
    return 'config-problem'
  }
  if (
    t.includes('nu1301') ||
    t.includes('nu1302') ||
    t.includes('nu1303') ||
    t.includes('nu1304') ||
    t.includes('unable to load the service index') ||
    t.includes('401') ||
    t.includes('403') ||
    t.includes('unauthorized') ||
    t.includes('forbidden') ||
    t.includes('connection refused') ||
    t.includes('timed out')
  ) {
    return 'repository-or-network'
  }
  if (
    t.includes('nu1101') ||
    t.includes('nu1102') ||
    t.includes('nu1103') ||
    t.includes('unable to find package')
  ) {
    return 'not-found'
  }
  // Project/framework incompatibilities and a restore that never produced an
  // assets file are project-configuration problems, not missing packages.
  if (
    t.includes('nu1105') ||
    t.includes('nu1201') ||
    t.includes('nu1202') ||
    t.includes('is not compatible with') ||
    t.includes('produced no project.assets.json')
  ) {
    return 'config-problem'
  }
  return 'other'
}

export const NUGET_DIALECT: ResolutionDialect = {
  label: 'NuGet',
  classify: classifyNugetFailure,
  configNoun: 'target framework',
  excludeConfigsFlag: '--exclude-target-frameworks',
  categories: [
    {
      key: 'not-found',
      header: () => `  Not found on any feed:`,
      blocking: true,
    },
    {
      key: 'repository-or-network',
      header: n =>
        `  Feed or network error — ${n} could not reach or authenticate to a package feed:`,
      blocking: true,
    },
    {
      key: 'config-problem',
      header: n => `  Project/restore problem (reason from ${n}):`,
      showReason: true,
      blocking: true,
    },
    {
      key: 'other',
      header: n => `  Other restore failures (reason from ${n}):`,
      showReason: true,
      blocking: true,
    },
  ],
}
