/**
 * Socket Facts Type Definitions
 *
 * Based on @coana-tech/cli's reachability analysis output.
 * These types define the structure of Socket Facts files which contain
 * vulnerability reachability data.
 */

/**
 * PURL type from packageurl-js.
 */
export type PURLType =
  | 'npm'
  | 'pypi'
  | 'cargo'
  | 'gem'
  | 'golang'
  | 'maven'
  | 'nuget'
  | 'generic'

/**
 * Reachability state for a vulnerability.
 */
export type ReachabilityState =
  | 'reachable'
  | 'unreachable'
  | 'pending'
  | 'error'
  | 'missing_support'
  | 'undeterminable_reachability'

/**
 * Source location in a file.
 */
export interface SourceLocation {
  file: string
  start: {
    line: number
    column: number
  }
  end?: {
    line: number
    column: number
  }
}

/**
 * Call stack entry for function-level reachability.
 */
export interface CallStackEntry {
  purl?: string
  package: string
  sourceLocation: SourceLocation
  confidence: number
}

/**
 * Class stack entry for class-level reachability.
 */
export interface ClassStackEntry {
  purl?: string
  package: string
  class: string
  confidence?: number
}

/**
 * Reachability analysis result for a specific vulnerability.
 */
export interface Reachability {
  vulnerability: string
  state: ReachabilityState
  confidence?: number
  reason?: string
  callStack?: CallStackEntry[]
  classStack?: ClassStackEntry[]
}

/**
 * Manifest file reference with line number.
 */
export interface ManifestReference {
  file: string
  lineNumber?: number
}

/**
 * Vulnerability with reachability data.
 */
export interface SocketVulnerability {
  ghsaId: string
  range: string
  reachabilityData: {
    publicComment: string
    pattern: string[]
    undeterminableReachability: boolean
  } | null
}

/**
 * Socket Fact Artifact (extends PURL).
 */
export interface SocketFactArtifact {
  // PURL fields.
  type: PURLType
  namespace?: string
  name: string
  version?: string
  qualifiers?: Record<string, string>

  // Socket Facts fields.
  id: string
  reachability?: Reachability[]
  direct: boolean
  dev: boolean
  dead: boolean
  dependencies?: string[]
  manifestFiles?: ManifestReference[]
  vulnerabilities?: SocketVulnerability[]
  files?: string
  toplevelAncestors?: string[]
}

/**
 * Socket Facts top-level structure.
 */
export interface SocketFacts {
  skipEcosystems?: PURLType[]
  components: SocketFactArtifact[]
  tier1ReachabilityScanId?: string
}
