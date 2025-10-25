/**
 * CycloneDX SBOM v1.5 Type Definitions
 *
 * Complete TypeScript types for CycloneDX Software Bill of Materials (SBOM) format.
 * Spec: https://cyclonedx.org/docs/1.5/json/
 */

/**
 * Root SBOM object.
 */
export interface Sbom {
  bomFormat: 'CycloneDX'
  specVersion: '1.5'
  serialNumber?: string  // urn:uuid format
  version: number
  metadata?: Metadata
  components?: Component[]
  services?: Service[]
  dependencies?: Dependency[]
  compositions?: Composition[]
  vulnerabilities?: Vulnerability[]
  properties?: Property[]
}

/**
 * SBOM metadata.
 */
export interface Metadata {
  timestamp?: string  // ISO 8601
  tools?: Tool[]
  authors?: OrganizationalContact[]
  component?: Component  // Main project component
  manufacture?: OrganizationalEntity
  supplier?: OrganizationalEntity
  licenses?: LicenseChoice[]
  properties?: Property[]
}

/**
 * Tool that generated the SBOM.
 */
export interface Tool {
  vendor?: string
  name?: string
  version?: string
  hashes?: Hash[]
  externalReferences?: ExternalReference[]
}

/**
 * Software component (package, library, application).
 */
export interface Component {
  type: ComponentType
  'bom-ref'?: string  // Unique identifier
  supplier?: OrganizationalEntity
  author?: string
  publisher?: string
  group?: string  // Namespace/organization
  name: string
  version: string
  description?: string
  scope?: Scope
  hashes?: Hash[]
  licenses?: LicenseChoice[]
  copyright?: string
  purl?: string  // Package URL
  cpe?: string  // Common Platform Enumeration
  swid?: Swid
  modified?: boolean
  pedigree?: Pedigree
  externalReferences?: ExternalReference[]
  components?: Component[]  // Nested components
  evidence?: ComponentEvidence
  properties?: Property[]
  signature?: Signature
}

export type ComponentType =
  | 'application'
  | 'framework'
  | 'library'
  | 'container'
  | 'operating-system'
  | 'device'
  | 'firmware'
  | 'file'
  | 'machine-learning-model'
  | 'data'

export type Scope = 'required' | 'optional' | 'excluded'

/**
 * Service component.
 */
export interface Service {
  'bom-ref'?: string
  provider?: OrganizationalEntity
  group?: string
  name: string
  version?: string
  description?: string
  endpoints?: string[]
  authenticated?: boolean
  'x-trust-boundary'?: boolean
  data?: DataClassification[]
  licenses?: LicenseChoice[]
  externalReferences?: ExternalReference[]
  properties?: Property[]
  services?: Service[]  // Nested services
}

/**
 * Dependency relationship.
 */
export interface Dependency {
  ref: string  // bom-ref of the component
  dependsOn?: string[]  // Array of bom-refs
}

/**
 * Composition describes component assemblies.
 */
export interface Composition {
  aggregate: AggregateType
  assemblies?: string[]  // bom-refs
  dependencies?: string[]  // bom-refs
  signature?: Signature
}

export type AggregateType =
  | 'complete'
  | 'incomplete'
  | 'incomplete_first_party_only'
  | 'incomplete_third_party_only'
  | 'unknown'
  | 'not_specified'

/**
 * Known vulnerability.
 */
export interface Vulnerability {
  'bom-ref'?: string
  id?: string  // CVE, GHSA, etc.
  source?: VulnerabilitySource
  references?: VulnerabilityReference[]
  ratings?: VulnerabilityRating[]
  cwes?: number[]  // CWE IDs
  description?: string
  detail?: string
  recommendation?: string
  advisories?: Advisory[]
  created?: string
  published?: string
  updated?: string
  credits?: VulnerabilityCredit
  tools?: Tool[]
  analysis?: VulnerabilityAnalysis
  affects?: VulnerabilityAffect[]
  properties?: Property[]
}

export interface VulnerabilitySource {
  url?: string
  name?: string
}

export interface VulnerabilityReference {
  id: string
  source?: VulnerabilitySource
}

export interface VulnerabilityRating {
  source?: VulnerabilitySource
  score?: number
  severity?: VulnerabilitySeverity
  method?: VulnerabilityRatingMethod
  vector?: string
  justification?: string
}

export type VulnerabilitySeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info'
  | 'none'
  | 'unknown'

export type VulnerabilityRatingMethod =
  | 'CVSSv2'
  | 'CVSSv3'
  | 'CVSSv31'
  | 'OWASP'
  | 'other'

export interface Advisory {
  title?: string
  url: string
}

export interface VulnerabilityCredit {
  organizations?: OrganizationalEntity[]
  individuals?: OrganizationalContact[]
}

export interface VulnerabilityAnalysis {
  state?: AnalysisState
  justification?: AnalysisJustification
  response?: AnalysisResponse[]
  detail?: string
}

export type AnalysisState =
  | 'resolved'
  | 'resolved_with_pedigree'
  | 'exploitable'
  | 'in_triage'
  | 'false_positive'
  | 'not_affected'

export type AnalysisJustification =
  | 'code_not_present'
  | 'code_not_reachable'
  | 'requires_configuration'
  | 'requires_dependency'
  | 'requires_environment'
  | 'protected_by_compiler'
  | 'protected_at_runtime'
  | 'protected_at_perimeter'
  | 'protected_by_mitigating_control'

export type AnalysisResponse =
  | 'can_not_fix'
  | 'will_not_fix'
  | 'update'
  | 'rollback'
  | 'workaround_available'

export interface VulnerabilityAffect {
  ref: string  // bom-ref
  versions?: VulnerabilityAffectedVersionRange[]
}

export interface VulnerabilityAffectedVersionRange {
  version?: string
  range?: string
  status?: VulnerabilityAffectedStatus
}

export type VulnerabilityAffectedStatus = 'affected' | 'unaffected' | 'unknown'

/**
 * Cryptographic hash.
 */
export interface Hash {
  alg: HashAlgorithm
  content: string
}

export type HashAlgorithm =
  | 'MD5'
  | 'SHA-1'
  | 'SHA-256'
  | 'SHA-384'
  | 'SHA-512'
  | 'SHA3-256'
  | 'SHA3-384'
  | 'SHA3-512'
  | 'BLAKE2b-256'
  | 'BLAKE2b-384'
  | 'BLAKE2b-512'
  | 'BLAKE3'

/**
 * License information.
 */
export interface LicenseChoice {
  license?: License
  expression?: string  // SPDX expression
}

export interface License {
  id?: string  // SPDX ID
  name?: string
  text?: AttachedText
  url?: string
}

export interface AttachedText {
  contentType?: string
  encoding?: Encoding
  content: string
}

export type Encoding = 'base64'

/**
 * External reference (URL, repository, etc.).
 */
export interface ExternalReference {
  url: string
  type: ExternalReferenceType
  comment?: string
  hashes?: Hash[]
}

export type ExternalReferenceType =
  | 'vcs'
  | 'issue-tracker'
  | 'website'
  | 'advisories'
  | 'bom'
  | 'mailing-list'
  | 'social'
  | 'chat'
  | 'documentation'
  | 'support'
  | 'source-distribution'
  | 'distribution'
  | 'distribution-intake'
  | 'license'
  | 'build-meta'
  | 'build-system'
  | 'release-notes'
  | 'security-contact'
  | 'model-card'
  | 'log'
  | 'configuration'
  | 'evidence'
  | 'formulation'
  | 'attestation'
  | 'threat-model'
  | 'adversary-model'
  | 'risk-assessment'
  | 'vulnerability-assertion'
  | 'exploitability-statement'
  | 'pentest-report'
  | 'static-analysis-report'
  | 'dynamic-analysis-report'
  | 'runtime-analysis-report'
  | 'component-analysis-report'
  | 'maturity-report'
  | 'certification-report'
  | 'quality-metrics'
  | 'codified-infrastructure'
  | 'other'

/**
 * Organizational entity.
 */
export interface OrganizationalEntity {
  name?: string
  url?: string[]
  contact?: OrganizationalContact[]
}

export interface OrganizationalContact {
  name?: string
  email?: string
  phone?: string
}

/**
 * Software identification (SWID) tag.
 */
export interface Swid {
  tagId: string
  name: string
  version?: string
  tagVersion?: number
  patch?: boolean
  text?: AttachedText
  url?: string
}

/**
 * Component pedigree (ancestry and evolution).
 */
export interface Pedigree {
  ancestors?: Component[]
  descendants?: Component[]
  variants?: Component[]
  commits?: Commit[]
  patches?: Patch[]
  notes?: string
}

export interface Commit {
  uid?: string
  url?: string
  author?: IdentifiableAction
  committer?: IdentifiableAction
  message?: string
}

export interface IdentifiableAction {
  timestamp?: string
  name?: string
  email?: string
}

export interface Patch {
  type: PatchType
  diff?: Diff
  resolves?: Issue[]
}

export type PatchType = 'unofficial' | 'monkey' | 'backport' | 'cherry-pick'

export interface Diff {
  text?: AttachedText
  url?: string
}

export interface Issue {
  type: IssueType
  id?: string
  name?: string
  description?: string
  source?: VulnerabilitySource
  references?: string[]
}

export type IssueType = 'defect' | 'enhancement' | 'security'

/**
 * Component evidence.
 */
export interface ComponentEvidence {
  licenses?: LicenseChoice[]
  copyright?: Copyright[]
  identity?: Identity
  occurrences?: Occurrence[]
  callstack?: Callstack
}

export interface Copyright {
  text: string
}

export interface Identity {
  field?: IdentityField
  confidence?: number  // 0.0 to 1.0
  methods?: IdentityMethod[]
  tools?: Tool[]
}

export type IdentityField =
  | 'group'
  | 'name'
  | 'version'
  | 'purl'
  | 'cpe'
  | 'swid'
  | 'hash'

export interface IdentityMethod {
  technique?: string
  confidence?: number
  value?: string
}

export interface Occurrence {
  'bom-ref'?: string
  location?: string
}

export interface Callstack {
  frames?: Frame[]
}

export interface Frame {
  package?: string
  module?: string
  function?: string
  parameters?: string[]
  line?: number
  column?: number
  fullFilename?: string
}

/**
 * Data classification.
 */
export interface DataClassification {
  flow: DataFlow
  classification: string
}

export type DataFlow =
  | 'inbound'
  | 'outbound'
  | 'bi-directional'
  | 'unknown'

/**
 * Generic property (name-value pair).
 */
export interface Property {
  name: string
  value?: string
}

/**
 * Digital signature.
 */
export interface Signature {
  algorithm: SignatureAlgorithm
  keyId?: string
  publicKey?: PublicKey
  certificatePath?: string[]
  excludes?: string[]
  signers?: Signer[]
  value: string
}

export type SignatureAlgorithm =
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'Ed25519'
  | 'Ed448'
  | 'HS256'
  | 'HS384'
  | 'HS512'

export interface PublicKey {
  kty?: string
  crv?: string
  x?: string
  y?: string
  n?: string
  e?: string
}

export interface Signer {
  algorithm?: SignatureAlgorithm
  keyId?: string
  publicKey?: PublicKey
  certificatePath?: string[]
  value?: string
}
