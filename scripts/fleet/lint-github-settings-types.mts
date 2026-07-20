/**
 * @file Shared types + constants for `lint-github-settings.mts`'s audit.
 *   Split out so each file in the split stays under the 500-line soft cap —
 *   pure type/const data, zero runtime side effects.
 */

interface RepoApiPayload {
  default_branch?: string | undefined
  has_wiki?: boolean | undefined
  has_discussions?: boolean | undefined
  has_projects?: boolean | undefined
  allow_forking?: boolean | undefined
  allow_squash_merge?: boolean | undefined
  allow_merge_commit?: boolean | undefined
  allow_rebase_merge?: boolean | undefined
  allow_auto_merge?: boolean | undefined
  allow_update_branch?: boolean | undefined
  delete_branch_on_merge?: boolean | undefined
  pull_request_creation_policy?: string | undefined
  web_commit_signoff_required?: boolean | undefined
  full_name?: string | undefined
  fork?: boolean | undefined
}

interface BranchProtectionPayload {
  required_signatures?: { enabled?: boolean | undefined } | undefined
  required_pull_request_reviews?:
    | {
        required_approving_review_count?: number | undefined
        require_code_owner_reviews?: boolean | undefined
        dismiss_stale_reviews?: boolean | undefined
      }
    | undefined
  allow_force_pushes?: { enabled?: boolean | undefined } | undefined
  allow_deletions?: { enabled?: boolean | undefined } | undefined
  enforce_admins?: { enabled?: boolean | undefined } | undefined
}

/**
 * GitHub custom-property values for the repo, shaped as the API returns: an
 * array of `{ property_name, value }` pairs. We normalize to `Record<string,
 * string | null>` at read time.
 *
 * Recognized fleet properties:
 *
 * - `disable-github-actions-security` ('true' | 'false') When 'true', the fleet's
 *   branch-protection-must-require-signed- commits rule downgrades from error →
 *   warn. Rationale: the shared socket-registry setup/install action IS the
 *   security gate; per-repo branch protection is belt-and-suspenders.
 * - `doesnt-touch-customers` ('true' | 'false') Public repos default 'false'
 *   (they DO touch customers; full fleet rules apply). Private repos not
 *   published to npm can set 'true' to opt out of customer-facing rules.
 * - `temporarily-doesnt-touch-customers` ('true' | 'false') Escape hatch for
 *   repos mid-remediation. Always downgrades customer-facing rules to warn.
 *   Should be removed once the remediation lands.
 */
interface CustomPropertyValue {
  property_name?: string | undefined
  value?: string | null | undefined
}

export type Severity = 'error' | 'warn'

export interface Finding {
  rule: string
  severity: Severity
  current: unknown
  expected: unknown
  fixUrl: string
  fixable: boolean
  /**
   * PATCH-shaped patch payload to apply when --fix is given.
   */
  fixPatch?: Record<string, unknown> | undefined
  /**
   * Required permission for the PATCH; informational.
   */
  fixRequires?: string | undefined
}

export interface CacheEntry {
  verifiedAt: string
  repo: string
  pass: boolean
  ttl: number
  findings: Finding[]
}

export interface CliFlags {
  fix: boolean
  force: boolean
  json: boolean
}

/**
 * Required GitHub Apps. We can't list installations directly without
 * `admin:org` scope, so we infer presence from recent check-run activity on
 * main HEAD. An app that's installed but inactive on main may false-negative;
 * for the fleet's hot repos this is rare.
 *
 * Alphabetical order.
 */
export const REQUIRED_APP_SLUGS = [
  'cursor',
  'socket-security',
  'socket-trufflehog',
] as const

export interface CheckSuitesPayload {
  check_suites?:
    | Array<{
        app?: { slug?: string | undefined } | undefined
      }>
    | undefined
}

export interface WorkflowsPayload {
  workflows?:
    | Array<{
        name?: string | undefined
        path?: string | undefined
        state?: string | undefined
      }>
    | undefined
}

/**
 * Names of canonical shared workflows hosted in socket-registry. When a fleet
 * repo has a local workflow file whose path basename matches one of these AND
 * the workflow body doesn't `uses:` the shared variant AND doesn't carry the
 * explicit opt-out marker, that's drift.
 *
 * Two exemption shapes:
 *
 * 1. `_local-not-for-reuse-*` filename prefix — the socket-registry convention for
 *    local triggers that consume a shared workflow. The file IS the right
 *    shape.
 * 2. `# socket-wheelhouse-shadow-allow: <reason>` header line — maintainer's
 *    explicit, audit-able commitment that the local workflow inlines logic by
 *    design (e.g. socket-cli's publish-npm.yml does CLI-specific multi-package
 *    release orchestration that doesn't fit the generic shared shape). The
 *    comment text serves as the documented reason.
 */
export const SHARED_WORKFLOW_BASENAMES = [
  'build.yml',
  'install.yml',
  'lint.yml',
  'publish-npm.yml',
  'release.yml',
  'setup.yml',
  'test.yml',
] as const

export type { BranchProtectionPayload, CustomPropertyValue, RepoApiPayload }
