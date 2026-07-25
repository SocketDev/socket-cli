/**
 * @file Npm-specific shared helpers for the npm-publish modes: the
 *   staged-entry shape, package.json + staged-shasum readers, the
 *   `pnpm stage list` fetch, prior-provenance lookup, and the
 *   staging-expected trust check consumed by both --staged and --direct.
 */

import os from 'node:os'

import { resolveReleaseSubject } from '../../_shared/release-subject.mts'
import { extractFirstJson, rootPath, runCapture } from '../shared.mts'
import { fetchVersionTrustInfo } from './registry.mts'

/**
 * Raised when the staged-entry listing could not be AUTHENTICATED. The stage
 * endpoints 401 without npm auth and `pnpm stage list`'s failure output
 * parses as an EMPTY list — the 6.2.1 run recorded that as verify=failed
 * "0 staged entries", a false negative that stranded the pipeline. Callers
 * must treat this error as "auth unavailable", never as an empty stage list.
 */
export class StageListAuthError extends Error {}

export interface StageListEntry {
  name?: string | undefined
  version?: string | undefined
  stageId?: string | undefined
  // sha1 hex npm recorded for the staged tarball. `pnpm stage list --json` is
  // the ONLY pre-approve source of the server-side digest — a staged version is
  // not in the public packument, so fetchVersionTrustInfo can't see it. Live
  // pnpm emits it top-level as `shasum` (verified against a real staged run);
  // readStagedShasum keeps the `dist.shasum` probe as a fallback and the gate
  // fails LOUD (never silently skips) when none resolve.
  shasum?: string | undefined
}

/**
 * The PUBLISH SUBJECT's name/version/repository — the root package.json for a
 * plain repo, the `publishConfig.directory` manifest for a redirected monorepo
 * like socket-registry. Every guard that keys on "this repo's package"
 * (already-published refusal, cross-repo pack refusal, approve's local-entry
 * match) must see the subject, never a private root. `root` is injectable for
 * tests.
 */
export function readPackageJson(root: string = rootPath): {
  name: string
  version: string
  repository?: string | { url?: string | undefined } | undefined
} {
  const subject = resolveReleaseSubject(root)
  return {
    name: subject.name,
    repository: subject.repository,
    version: subject.version,
  }
}

/**
 * Extract the staged tarball's sha1 from a `pnpm stage list --json` entry.
 * Live pnpm emits top-level `shasum` (verified against a real staged run);
 * `dist.shasum` stays as a fallback probe. Returns undefined when none
 * resolve; the pre-approve gate then fails LOUD (never silently skips) so a
 * field-name drift surfaces as a hard stop, not a false-green. (`integrity` is
 * sha512 — a different axis — so it is not reduced to sha1 here.)
 */
export function readStagedShasum(entry: {
  dist?: { shasum?: unknown | undefined } | undefined
  shasum?: unknown | undefined
}): string | undefined {
  if (typeof entry.shasum === 'string' && entry.shasum) {
    return entry.shasum
  }
  if (typeof entry.dist?.shasum === 'string' && entry.dist.shasum) {
    return entry.dist.shasum
  }
  return undefined
}

// A raw `pnpm stage list --json` entry across the shapes we've seen: live
// pnpm emits `{ id, packageName, version, shasum, … }`; the older keyed-map
// shape used `{ stageId, name, … }`.
interface RawStageEntry {
  dist?: { shasum?: unknown | undefined } | undefined
  id?: unknown | undefined
  name?: unknown | undefined
  packageName?: unknown | undefined
  shasum?: unknown | undefined
  stageId?: unknown | undefined
  version?: unknown | undefined
}

function normalizeStageEntry(raw: RawStageEntry): StageListEntry | undefined {
  const stageId =
    typeof raw.id === 'string' && raw.id
      ? raw.id
      : typeof raw.stageId === 'string' && raw.stageId
        ? raw.stageId
        : undefined
  if (!stageId) {
    return undefined
  }
  const name =
    typeof raw.packageName === 'string' && raw.packageName
      ? raw.packageName
      : typeof raw.name === 'string' && raw.name
        ? raw.name
        : undefined
  return {
    name,
    shasum: readStagedShasum(raw),
    stageId,
    version: typeof raw.version === 'string' ? raw.version : undefined,
  }
}

/**
 * Parse `pnpm stage list --json` output into normalized entries. Live pnpm
 * (verified against a real staged run) emits an ARRAY of
 * `{ id, packageName, version, shasum, … }`; the older keyed-map shape
 * (`{ '<name>@<version>': { stageId, name, … } }`) is kept as a fallback.
 * Entries that don't resolve a stage id are dropped (defensive). Pure —
 * exported for tests.
 */
export function parseStageListJson(stdout: string): StageListEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    const json = extractFirstJson(stdout)
    if (!json) {
      return []
    }
    try {
      parsed = JSON.parse(json)
    } catch {
      return []
    }
  }
  const rawEntries: Array<RawStageEntry | undefined> = Array.isArray(parsed)
    ? (parsed as Array<RawStageEntry | undefined>)
    : parsed && typeof parsed === 'object'
      ? (Object.values(parsed) as Array<RawStageEntry | undefined>)
      : []
  const result: StageListEntry[] = []
  for (let i = 0, { length } = rawEntries; i < length; i += 1) {
    const raw = rawEntries[i]
    const entry = raw ? normalizeStageEntry(raw) : undefined
    if (entry) {
      result.push(entry)
    }
  }
  return result
}

/**
 * Resolve all currently-staged packages by running `pnpm stage list --json`
 * and normalizing the output (see parseStageListJson). Auth-honest: an empty
 * result (or a non-zero exit) is only trusted after `npm whoami` proves local
 * npm auth exists — an unauthenticated `pnpm stage list` 401s and its output
 * parses as an EMPTY list, indistinguishable from "nothing staged". Without
 * that proof this throws StageListAuthError carrying the whoami evidence, so
 * a missing token can never masquerade as "0 staged entries".
 */
export async function listStagedPackages(): Promise<StageListEntry[]> {
  const { code, stdout } = await runCapture(
    'pnpm',
    ['stage', 'list', '--json'],
    rootPath,
  )
  const entries = parseStageListJson(stdout)
  if (code === 0 && entries.length > 0) {
    return entries
  }
  // `npm whoami` runs from the OS home dir: the repo's devEngines pins pnpm
  // as the package manager and vetoes bare `npm` invocations in-repo.
  const whoami = await runCapture('npm', ['whoami'], os.homedir())
  if (whoami.code !== 0) {
    throw new StageListAuthError(
      `\`npm whoami\` exited ${whoami.code} — no npm auth, so the staging ` +
        `endpoints 401 — and \`pnpm stage list --json\` exited ${code} with ` +
        `${entries.length} parseable entr${entries.length === 1 ? 'y' : 'ies'}. ` +
        `An unauthenticated stage list parses as EMPTY; refusing to report ` +
        `"0 staged entries" without auth.`,
    )
  }
  return entries
}

/**
 * For each unique package name in `entries`, fetch the latest version's trust
 * info from the registry. Used to annotate the approve multi- select with a
 * "this package's last public version had provenance" hint — helps the approver
 * spot if their staged upload is a regression (parent name has provenance
 * history; staged version's workflow may have lost OIDC).
 *
 * One registry GET per unique name; abbreviated packument (saves ~80KB per
 * popular package, omits `_npmUser` which we don't need here).
 */
export async function fetchPriorProvenanceMap(
  entries: StageListEntry[],
): Promise<Map<string, boolean>> {
  const uniqueNames = new Set<string>()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (e.name) {
      uniqueNames.add(e.name)
    }
  }
  const result = new Map<string, boolean>()
  // oxlint-disable-next-line socket/prefer-all-settled -- fail-fast: a failed trust-info fetch makes the audit incomplete; abort rather than report partial attestation results.
  await Promise.all(
    [...uniqueNames].map(async name => {
      const versions = await fetchVersionTrustInfo(name, 'abbreviated')
      const hasAnyAttestation = Object.values(versions).some(
        v => !!v.attestations,
      )
      result.set(name, hasAnyAttestation)
    }),
  )
  return result
}

export function formatPriorProvenance(
  hasPriorProvenance: boolean | undefined,
): string {
  if (hasPriorProvenance === undefined) {
    return ''
  }
  return hasPriorProvenance
    ? '  [prior: ✓ provenance]'
    : '  [prior: ✗ no provenance]'
}

/**
 * Detect whether this package has previously been published via the staged
 * path. Returns true when ANY published version of `pkg.name` carries the
 * registry packument's `_npmUser.approver` field — the signal pnpm uses for its
 * `stagedPublish` trust-evidence tier (see github.com/pnpm/pnpm pull 12056). A
 * package with an approver in its history has chosen the strongest trust path
 * available; downgrading to --direct for a new version would erase that signal
 * in the package's trust chain.
 *
 * Used by --direct to refuse running when the package's prior versions used
 * staging: we want that trade-off to be a deliberate choice, not an accident.
 * First-publish packages (no prior versions) get a pass — they have no staged
 * history to preserve.
 */
export async function isStagingExpected(pkgName: string): Promise<boolean> {
  try {
    const versions = await fetchVersionTrustInfo(pkgName, 'full')
    const versionList = Object.values(versions)
    for (let i = 0, { length } = versionList; i < length; i += 1) {
      if (versionList[i]!.approver !== undefined) {
        return true
      }
    }
  } catch {
    // Network failure / 404 / unparseable packument — treat as
    // "unknown" and don't block the --direct path on it.
  }
  return false
}
