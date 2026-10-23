import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// Maven's resolver (Aether/maven-resolver): no attribute-based variants. Both
// failure shapes (artifact-resolution miss, dependency-graph build failure)
// classify off the root-cause message.
export function classifyMavenFailure(detail: string): FailureCategory {
  const t = (detail || '').toLowerCase()
  if (
    t.includes('could not transfer') ||
    t.includes('connection refused') ||
    t.includes('connect timed out') ||
    t.includes('connection timed out') ||
    t.includes('read timed out') ||
    t.includes('status code: 401') ||
    t.includes('status code: 403') ||
    t.includes('unauthorized') ||
    t.includes('forbidden') ||
    t.includes('peer not authenticated') ||
    t.includes('certpathbuilderexception') ||
    // Maven 3.8.1+ blocks plain-HTTP repositories behind its
    // maven-default-http-blocker mirror.
    t.includes('blocked mirror for repositories') ||
    // Offline (-o): no repository was asked, so the artifact may well exist.
    t.includes('in offline mode')
  ) {
    return 'repository-or-network'
  }
  if (
    t.includes('could not find artifact') ||
    t.includes('failure to find') ||
    t.includes('could not resolve') ||
    t.includes('no versions available') ||
    t.includes('not found') ||
    // maven-resolver's remote repository filters (prefixes, groupId): the
    // repository is known not to serve that path or group.
    t.includes('not allowed from')
  ) {
    return 'not-found'
  }
  // POM exists but can't be read/parsed.
  if (
    t.includes('failed to read artifact descriptor') ||
    t.includes('invalid pom') ||
    t.includes('could not parse pom') ||
    // Maven's warning for a POM its descriptor policy tolerated as invalid.
    t.includes('is invalid, transitive dependencies')
  ) {
    return 'config-problem'
  }
  return 'other'
}

// Every kind blocks; no non-blocking kind because Maven has no variant ambiguity.
export const MAVEN_DIALECT: ResolutionDialect = {
  label: 'Maven',
  classify: classifyMavenFailure,
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
      header: n => `  POM/descriptor problem (reason from ${n}):`,
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
