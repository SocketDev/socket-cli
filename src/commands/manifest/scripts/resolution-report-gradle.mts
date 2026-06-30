import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// Gradle's variant-aware resolver: distinct exceptions give mutually-exclusive
// phrasing, so most-specific-first substring checks classify reliably.
export function classifyGradleFailure(detail: string): FailureCategory {
  const t = (detail || '').toLowerCase()
  // Check before variant ambiguity.
  if (t.includes('conflict on capability')) {
    return 'capability-conflict'
  }
  // Zero compatible variants — the opposite of ambiguity below.
  if (t.includes('no matching variant') || t.includes('no variants of')) {
    return 'no-matching-variant'
  }
  if (t.includes('cannot choose between')) {
    return 'variant-ambiguity'
  }
  if (
    t.includes('could not get') ||
    t.includes('could not head') ||
    t.includes('status code 401') ||
    t.includes('status code 403') ||
    t.includes('connection refused') ||
    t.includes('connection timed out') ||
    t.includes('read timed out') ||
    t.includes('certification path') ||
    t.includes('peer not authenticated')
  ) {
    return 'repository-or-network'
  }
  if (t.includes('could not find')) {
    return 'not-found'
  }
  return 'other'
}

// Every kind blocks except variant-ambiguity: the module demonstrably exists
// and is almost always captured via another configuration, so it's benign for
// the SBOM (non-blocking, count only). A module that resolves in NO config
// surfaces as not-found / no-matching-variant, which stay blocking.
export const GRADLE_DIALECT: ResolutionDialect = {
  label: 'Gradle',
  classify: classifyGradleFailure,
  categories: [
    {
      key: 'not-found',
      header: () => `  Not found in any repository:`,
      blocking: true,
    },
    {
      key: 'no-matching-variant',
      header: n =>
        `  No compatible variant — ${n} found the module but no variant matched the requested attributes:`,
      blocking: true,
    },
    {
      key: 'capability-conflict',
      header: n =>
        `  Capability conflict — ${n} found two modules providing the same capability and cannot use both (add a capability-resolution or module-replacement rule):`,
      showReason: true,
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
    {
      key: 'variant-ambiguity',
      blocking: false,
      notice: (n, depCount, configCount) =>
        `Skipped ${depCount} dependency(ies) with ambiguous variant selection in ${configCount} configuration(s) — re-run with --verbose for ${n}'s messages.`,
    },
  ],
}
