/**
 * @file Pure planners for the npm Trusted Publisher settings driver — the
 *   canonical desired config (law as data), the desired-vs-current diffing,
 *   the re-read-based save verify, the worklist expansion parser, and the
 *   human-readable renderers. No playwright, no network — every page value
 *   arrives already parsed by `trusted-publisher-parse.mts`, so all of this
 *   is unit-testable from fixtures. The browser side lives in
 *   `trusted-publisher-browser.mts` / `trusted-publisher-page.mts`.
 */

import { allowsAction } from './trusted-publisher-parse.mts'
import type {
  AccessPageState,
  TrustedPublisherCurrent,
} from './trusted-publisher-parse.mts'

// --- The canonical desired config: LAW AS DATA -----------------------------
//
// The law is the OBSERVED working shape of @socketsecurity/odai and
// @socketsecurity/lib — the two packages that publish successfully through
// the staged flow today — never a guess. Provenance, 2026-07-30: the fleet's
// publish surface pins workflow `npm-publish.yml` and the branch-restricted
// `npm-publish` environment; the staged flow stages via `npm stage publish`
// and the approve step promotes via plain `npm publish`, so BOTH actions are
// expected allowed. The confirming live `read` against odai + lib did not
// complete at authoring time — the durable profile had no npm sign-in within
// the wait budget — so BEFORE the first live sweep, run:
//   node scripts/fleet/publish-infra/npm/trusted-publisher-browser.mts \
//     read @socketsecurity/odai @socketsecurity/lib
// and reconcile any delta here (dated) before trusting `apply --drive`.

export const CANONICAL_WORKFLOW_FILENAME = 'npm-publish.yml'
export const CANONICAL_ENVIRONMENT_NAME = 'npm-publish'
export const CANONICAL_ALLOW_NPM_PUBLISH = true
export const CANONICAL_ALLOW_NPM_STAGE_PUBLISH = true

// The pre-rename legacy workflow filename still stored on stale fleet
// configs (seen on @socketregistry/es-iterator-helpers, 2026-07-29). A config
// naming it points npm's OIDC claim matching at a workflow that no longer
// exists, so it NEVER conforms — the diff must always flag it.
export const LEGACY_WORKFLOW_FILENAMES: readonly string[] = [
  '_local-not-for-reuse-provenance.yml',
]

// Every @socketregistry/* package publishes from the socket-registry monorepo.
export const SOCKET_REGISTRY_SCOPE = '@socketregistry/'
export const SOCKET_REGISTRY_REPO_OWNER = 'SocketDev'
export const SOCKET_REGISTRY_REPO_NAME = 'socket-registry'

/**
 * The Trusted Publisher shape a package SHOULD have — one row of the law.
 */
export interface TrustedPublisherDesired {
  allowNpmPublish: boolean
  allowNpmStagePublish: boolean
  environmentName: string
  repositoryName: string
  repositoryOwner: string
  workflowFilename: string
}

/**
 * The desired config for `pkg`, or undefined when no repo can be derived.
 * Repo resolution, in precedence order: the operator's `repoOverride`
 * (`owner/name`); the socket-registry monorepo for any `@socketregistry/*`
 * package; the package's own CURRENTLY configured repo (fleet packages
 * already point at their roster repo — only the workflow/environment/actions
 * went stale). Everything else is fixed by the canonical law consts. Pure —
 * exported for tests.
 */
export function desiredTrustedPublisher(config: {
  current?: TrustedPublisherCurrent | undefined
  pkg: string
  repoOverride?: string | undefined
}): TrustedPublisherDesired | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  let owner: string | undefined
  let name: string | undefined
  if (cfg.repoOverride) {
    const slashIdx = cfg.repoOverride.indexOf('/')
    if (slashIdx > 0) {
      owner = cfg.repoOverride.slice(0, slashIdx)
      name = cfg.repoOverride.slice(slashIdx + 1) || undefined
    }
  } else if (cfg.pkg.startsWith(SOCKET_REGISTRY_SCOPE)) {
    owner = SOCKET_REGISTRY_REPO_OWNER
    name = SOCKET_REGISTRY_REPO_NAME
  } else if (cfg.current?.repositoryOwner && cfg.current.repositoryName) {
    owner = cfg.current.repositoryOwner
    name = cfg.current.repositoryName
  }
  if (!owner || !name) {
    return undefined
  }
  return {
    allowNpmPublish: CANONICAL_ALLOW_NPM_PUBLISH,
    allowNpmStagePublish: CANONICAL_ALLOW_NPM_STAGE_PUBLISH,
    environmentName: CANONICAL_ENVIRONMENT_NAME,
    repositoryName: name,
    repositoryOwner: owner,
    workflowFilename: CANONICAL_WORKFLOW_FILENAME,
  }
}

/**
 * One planned form edit, keyed by npm's form field name (the wire contract:
 * `repositoryOwner`, `repositoryName`, `workflowName`,
 * `githubEnvironmentName`, `allowPublish`, `allowStagePublish`).
 */
export interface FormEdit {
  field: string
  from: string
  to: string
}

/**
 * The exact form edits that take `current` to `desired` — empty means the
 * config already conforms. An unconfigured package (undefined `current`)
 * yields the full field set. An EMPTY environment is a mismatch, never a
 * wildcard: the fleet's branch-restricted `npm-publish` environment only
 * engages when the config names it, so a blank field is exactly the staleness
 * this driver exists to fix. A legacy workflow filename likewise never
 * conforms. Pure — exported for tests.
 */
export function diffTrustedPublisher(config: {
  current?: TrustedPublisherCurrent | undefined
  desired: TrustedPublisherDesired
}): FormEdit[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const { current, desired } = cfg
  const edits: FormEdit[] = []
  const push = (field: string, from: string | undefined, to: string) => {
    const have = from ?? ''
    if (have !== to) {
      edits.push({ field, from: have === '' ? '(empty)' : have, to })
    }
  }
  push('repositoryOwner', current?.repositoryOwner, desired.repositoryOwner)
  push('repositoryName', current?.repositoryName, desired.repositoryName)
  push('workflowName', current?.workflowFilename, desired.workflowFilename)
  push(
    'githubEnvironmentName',
    current?.environmentName,
    desired.environmentName,
  )
  const actions = current?.allowedActions ?? []
  const boxes: Array<['allowPublish' | 'allowStagePublish', boolean, boolean]> =
    [
      [
        'allowPublish',
        allowsAction(actions, 'publish'),
        desired.allowNpmPublish,
      ],
      [
        'allowStagePublish',
        allowsAction(actions, 'stage-publish'),
        desired.allowNpmStagePublish,
      ],
    ]
  for (let i = 0, { length } = boxes; i < length; i += 1) {
    const [field, have, want] = boxes[i]!
    if (have !== want) {
      edits.push({
        field,
        from: have ? 'checked' : 'unchecked',
        to: want ? 'checked' : 'unchecked',
      })
    }
  }
  return edits
}

/**
 * The verdict after a Save: did the RE-READ page land on `desired`? Success
 * is the page's answer, never the click — a `reread` of undefined (the page
 * would not re-read, or came back unconfigured) FAILS, because a click whose
 * outcome cannot be observed proves nothing. Pure — exported for tests.
 */
export function verifySavedState(config: {
  desired: TrustedPublisherDesired
  reread: TrustedPublisherCurrent | undefined
}): { mismatches: string[]; ok: boolean } {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.reread) {
    return {
      mismatches: ['form not readable after save — saved state unproven'],
      ok: false,
    }
  }
  const edits = diffTrustedPublisher({
    current: cfg.reread,
    desired: cfg.desired,
  })
  const mismatches: string[] = []
  for (let i = 0, { length } = edits; i < length; i += 1) {
    const e = edits[i]!
    mismatches.push(`${e.field}: saved ${e.from}, wanted ${e.to}`)
  }
  return { mismatches, ok: mismatches.length === 0 }
}

/**
 * One published package row from socket-registry's `registry/manifest.json`.
 */
export interface RegistryManifestEntry {
  deprecated: boolean
  name: string
}

/**
 * Parse socket-registry's `registry/manifest.json` body into its published
 * package list. The manifest's `npm` value is an array of `[purl, data]`
 * pairs; the name comes from `data.name`, falling back to decoding the purl
 * (`pkg:npm/%40socketregistry/abab@1.0.9`). Deduped and sorted so the
 * worklist is deterministic. Throws on a body that is not that shape — the
 * expansion must never silently produce an empty sweep. Pure — exported for
 * tests.
 */
export function parseSocketRegistryManifest(
  manifestJson: string,
): RegistryManifestEntry[] {
  const parsed = JSON.parse(manifestJson) as { npm?: unknown | undefined }
  if (!Array.isArray(parsed.npm)) {
    throw new Error(
      'socket-registry manifest has no `npm` array — refusing to expand ' +
        'an empty worklist.',
    )
  }
  const byName = new Map<string, RegistryManifestEntry>()
  for (let i = 0, { length } = parsed.npm; i < length; i += 1) {
    const entry = parsed.npm[i] as unknown[]
    if (!Array.isArray(entry)) {
      continue
    }
    const purl = typeof entry[0] === 'string' ? entry[0] : ''
    const data =
      entry[1] && typeof entry[1] === 'object'
        ? (entry[1] as Record<string, unknown>)
        : {}
    let name = typeof data['name'] === 'string' ? data['name'] : ''
    if (!name) {
      // The npm purl shape: `pkg:npm/` then the percent-encoded package name,
      // then a final `@version` that stays outside the name capture.
      const m = /^pkg:npm\/(.+?)@[^@]+$/.exec(purl)
      name = m ? decodeURIComponent(m[1]!) : ''
    }
    if (name && !byName.has(name)) {
      // First row wins on a duplicate name — the manifest is ordered and the
      // dedup is purely defensive.
      byName.set(name, { deprecated: data['deprecated'] === true, name })
    }
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * One package's read-mode outcome, ready for the table renderer.
 */
export interface AccessReadRow {
  current?: TrustedPublisherCurrent | undefined
  detail?: string | undefined
  pkg: string
  state: AccessPageState
}

// The read-mode verdict for one row: conforming, stale (with the stale form
// fields named), or the non-configured state.
function readVerdict(row: AccessReadRow): string {
  if (row.state !== 'configured') {
    return row.detail ? `${row.state}: ${row.detail}` : row.state
  }
  const desired = desiredTrustedPublisher({
    current: row.current,
    pkg: row.pkg,
  })
  if (!desired) {
    return 'configured (no repo readable)'
  }
  const edits = diffTrustedPublisher({ current: row.current, desired })
  if (edits.length === 0) {
    return 'conforms'
  }
  const fields: string[] = []
  for (let i = 0, { length } = edits; i < length; i += 1) {
    fields.push(edits[i]!.field)
  }
  return `stale: ${fields.join(', ')}`
}

/**
 * Render read-mode rows as an aligned table: package, repo, workflow,
 * environment, allowed actions, verdict. Pure — exported for tests.
 */
export function renderReadTable(rows: readonly AccessReadRow[]): string {
  const header = [
    'package',
    'repo',
    'workflow',
    'environment',
    'allowed actions',
    'verdict',
  ]
  const lines: string[][] = [header]
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    const c = row.current
    const repo =
      c?.repositoryOwner && c.repositoryName
        ? `${c.repositoryOwner}/${c.repositoryName}`
        : '-'
    lines.push([
      row.pkg,
      repo,
      c?.workflowFilename ?? '-',
      c?.environmentName ?? '(empty)',
      c?.allowedActions.length ? c.allowedActions.join(' + ') : '-',
      readVerdict(row),
    ])
  }
  const widths: number[] = []
  for (let col = 0, cols = header.length; col < cols; col += 1) {
    let w = 0
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const cell = lines[i]![col] ?? ''
      if (cell.length > w) {
        w = cell.length
      }
    }
    widths.push(w)
  }
  const rendered: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const cells = lines[i]!
    const padded: string[] = []
    for (let col = 0, cols = cells.length; col < cols; col += 1) {
      padded.push((cells[col] ?? '').padEnd(widths[col]!))
    }
    rendered.push(padded.join('  ').trimEnd())
  }
  return rendered.join('\n')
}

/**
 * Render one package's planned form edits for the apply dry-run. Pure —
 * exported for tests.
 */
export function renderPlannedEdits(
  pkg: string,
  edits: readonly FormEdit[],
): string {
  if (edits.length === 0) {
    return `${pkg}: conforms — no edits`
  }
  const lines = [`${pkg}:`]
  for (let i = 0, { length } = edits; i < length; i += 1) {
    const e = edits[i]!
    lines.push(`    ${e.field}: ${e.from} -> ${e.to}`)
  }
  return lines.join('\n')
}

export type ApplyStatus =
  | 'applied'
  | 'conforms'
  | 'failed'
  | 'planned'
  | 'skipped'

export interface ApplyResult {
  detail?: string | undefined
  pkg: string
  status: ApplyStatus
}

/**
 * One-line human summary of an apply run: counts by status, tagged with the
 * mode. Pure — exported for tests.
 */
export function formatApplySummary(
  results: readonly ApplyResult[],
  config: { drive: boolean },
): string {
  const cfg = { __proto__: null, ...config } as { drive: boolean }
  const count = (status: ApplyStatus): number => {
    let n = 0
    for (let i = 0, { length } = results; i < length; i += 1) {
      if (results[i]!.status === status) {
        n += 1
      }
    }
    return n
  }
  return (
    `Trusted-publisher ${cfg.drive ? 'drive' : 'dry-run'} summary: ` +
    `${count('applied')} applied, ${count('planned')} planned, ` +
    `${count('conforms')} conforming, ${count('skipped')} skipped, ` +
    `${count('failed')} failed.`
  )
}
