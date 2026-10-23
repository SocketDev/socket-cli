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
  // Zero compatible variants — the opposite of ambiguity below. Gradle phrases
  // this several ways depending on version and whether attributes were supplied.
  if (
    t.includes('no matching variant') ||
    t.includes('no variants of') ||
    t.includes('unable to find a matching variant') ||
    t.includes('no compatible variant')
  ) {
    return 'no-matching-variant'
  }
  // The artifact-level form: several transforms produce the requested variant
  // (Gradle 9 says "transformation chains", earlier versions "transforms").
  if (
    t.includes('cannot choose between') ||
    t.includes('found multiple transformation chains') ||
    t.includes('found multiple transforms that can produce a variant')
  ) {
    return 'variant-ambiguity'
  }
  // One line per problem of the artifact; a checksum missing from the
  // metadata is no evidence against it, unlike any other problem.
  const problems = t.split('\n').filter(l => l.startsWith('on artifact '))
  if (
    problems.length &&
    problems.every(l =>
      l.endsWith(': checksum is missing from verification metadata.'),
    )
  ) {
    return 'checksum-missing'
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
// the SBOM (non-blocking, count only). The renderer blocks it anyway when the
// module resolved in no configuration of its project. Nor does checksum-missing,
// whose module always resolved: teams often record checksums only for what
// their own tasks resolve, and the artifact is still left uninstalled for
// reachability.
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
      header: n =>
        `  Ambiguous variant — ${n} could not choose a variant, and the module resolved in no other configuration:`,
      blocking: false,
      notice: (n, depCount, configCount) =>
        `Skipped ${depCount} dependency(ies) with ambiguous variant selection in ${configCount} configuration(s) — re-run with --verbose for ${n}'s messages.`,
    },
    {
      key: 'checksum-missing',
      blocking: false,
      notice: (n, depCount, configCount) =>
        `Left ${depCount} dependency(ies) uninstalled in ${configCount} configuration(s): ${n}'s verification metadata has no checksum for their artifacts — re-run with --verbose for ${n}'s messages.`,
    },
  ],
}
