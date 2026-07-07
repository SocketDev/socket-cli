import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// Ivy/sbt resolver: no attribute-based variants, so no variant categories
// (Gradle-only). Ivy degrades transport failures to "not found".
export function classifyIvyFailure(detail: string): FailureCategory {
  const t = (detail || '').toLowerCase()
  if (
    t.includes('server access error') ||
    t.includes('download failed') ||
    t.includes('connection timed out') ||
    t.includes('unauthorized') ||
    t.includes('forbidden')
  ) {
    return 'repository-or-network'
  }
  if (
    t.includes('no resolver found') ||
    t.includes('configuration not found') ||
    t.includes('configuration not public')
  ) {
    return 'config-problem'
  }
  if (t.includes('not found') || t.includes('unresolved dependency')) {
    return 'not-found'
  }
  return 'other'
}

// Every kind blocks; no non-blocking kind because Ivy has no variant ambiguity.
export const SBT_DIALECT: ResolutionDialect = {
  label: 'sbt',
  classify: classifyIvyFailure,
  categories: [
    {
      key: 'not-found',
      header: () => `  Not found in any repository:`,
      blocking: true,
    },
    {
      key: 'repository-or-network',
      header: n =>
        `  Repository or network error — ${n} could not reach or authenticate to a repository:`,
      blocking: true,
    },
    {
      key: 'config-problem',
      header: n => `  Resolver/configuration problem (reason from ${n}):`,
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
