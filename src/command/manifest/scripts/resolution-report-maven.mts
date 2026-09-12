import type {
  FailureCategory,
  ResolutionDialect,
} from './resolution-report-render.mts'

// Maven's resolver (Aether/maven-resolver): no attribute-based variants. Two
// failure shapes (artifact-resolution miss with config = scope, dependency-graph
// build failure with config = "graph") both classify off the root-cause message.
export function classifyMavenFailure(detail: string): FailureCategory {
  const t = (detail || '').toLowerCase()
  if (
    [
      'could not transfer',
      'connection refused',
      'connect timed out',
      'connection timed out',
      'read timed out',
      'status code: 401',
      'status code: 403',
      'unauthorized',
      'forbidden',
      'peer not authenticated',
      'certpathbuilderexception',
    ].some(message => t.includes(message))
  ) {
    return 'repository-or-network'
  }
  if (
    [
      'could not find artifact',
      'failure to find',
      'could not resolve',
      'no versions available',
      'not found',
    ].some(message => t.includes(message))
  ) {
    return 'not-found'
  }
  // POM exists but can't be read/parsed.
  if (
    [
      'failed to read artifact descriptor',
      'invalid pom',
      'could not parse pom',
    ].some(message => t.includes(message))
  ) {
    return 'config-problem'
  }
  return 'other'
}

// Every kind blocks; no non-blocking kind because Maven has no variant ambiguity.
export const MAVEN_DIALECT: ResolutionDialect = {
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
  classify: classifyMavenFailure,
  label: 'Maven',
}
