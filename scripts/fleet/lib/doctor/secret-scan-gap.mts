/**
 * @file Gap engine — committed-tree secret scan (TruffleHog). Pure functions,
 *   no FS reads, no spawn, no network. The doctor resolves the FLEET's
 *   integrity-pinned, per-platform TruffleHog binary (downloaded +
 *   sha512-verified by setup-security-tools; NEVER a system/unpinned one, since
 *   TruffleHog has been supply-chain-compromised historically) and spawns
 *   `trufflehog filesystem <repo> --json`. This engine parses that JSONL output
 *   into findings and formats a report-only DoctorFinding per hit. Secrets are
 *   NEVER auto-fixed — rotation + history purge is a human decision. Edit-time
 *   guards (secret-content-guard, no-token-in-dotenv-guard, token-guard) cover
 *   the write path; this is the missing committed-state scan.
 */

import type { DoctorFinding } from './catalog-gap.mts'

export interface TruffleHogHit {
  /**
   * The detector that matched, e.g. `'AWS'`, `'GitHub'`.
   */
  detectorName: string
  /**
   * Workspace-relative (or absolute, as TruffleHog emits) file path.
   */
  file: string
  /**
   * 1-based line number when TruffleHog reports one; undefined otherwise.
   */
  line: number | undefined
  /**
   * True when TruffleHog actively verified the credential against its live
   * service (a confirmed live secret, not just a pattern match).
   */
  verified: boolean
}

/**
 * Pull the file path + line from a TruffleHog SourceMetadata block. TruffleHog
 * nests the location under `Data.Filesystem` (a filesystem scan) or `Data.Git`
 * (a git scan); this reads whichever is present.
 */
export function readHitLocation(sourceMetadata: unknown): {
  file: string | undefined
  line: number | undefined
} {
  const data =
    sourceMetadata &&
    typeof sourceMetadata === 'object' &&
    'Data' in sourceMetadata
      ? (sourceMetadata as { Data?: unknown | undefined }).Data
      : undefined
  if (!data || typeof data !== 'object') {
    return { file: undefined, line: undefined }
  }
  const record = data as Record<string, unknown>
  const block = (record['Filesystem'] ?? record['Git']) as
    | Record<string, unknown>
    | undefined
  if (!block || typeof block !== 'object') {
    return { file: undefined, line: undefined }
  }
  const file = typeof block['file'] === 'string' ? block['file'] : undefined
  const rawLine = block['line']
  const line =
    typeof rawLine === 'number' && Number.isFinite(rawLine) && rawLine > 0
      ? rawLine
      : undefined
  return { file, line }
}

/**
 * Tolerant parse of TruffleHog `--json` output (JSONL — one JSON object per
 * line). Skips blank lines and any line that is not a well-formed finding
 * object (TruffleHog also emits progress/log lines). Returns one hit per
 * finding that carries a file location, deduplicated by
 * detector+file+line+verified.
 */
export function parseTruffleHogFindings(jsonlOutput: string): TruffleHogHit[] {
  const hits: TruffleHogHit[] = []
  const seen = new Set<string>()
  for (const rawLine of jsonlOutput.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed[0] !== '{') {
      continue
    }
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const detectorName = obj['DetectorName']
    if (typeof detectorName !== 'string' || !detectorName) {
      continue
    }
    const { file, line } = readHitLocation(obj['SourceMetadata'])
    if (!file) {
      continue
    }
    const verified = obj['Verified'] === true
    const key = `${detectorName}\x00${file}\x00${line ?? ''}\x00${verified}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    hits.push({ detectorName, file, line, verified })
  }
  return hits
}

/**
 * Sort hits so verified (live) secrets rank first, then by file + line, so the
 * operator triages the confirmed leaks before the pattern matches.
 */
export function sortHits(hits: readonly TruffleHogHit[]): TruffleHogHit[] {
  return [...hits].toSorted((a, b) => {
    if (a.verified !== b.verified) {
      return a.verified ? -1 : 1
    }
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1
    }
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

const ROTATE_FIX = [
  'Rotate the exposed credential IMMEDIATELY at its provider (assume it is',
  'compromised the moment it hit a commit), purge it from git history',
  '(git filter-repo or BFG, then force-push + re-clone everywhere), and move',
  'the value to the OS keychain (dev) or the CI secret store — never a tracked',
  'file. Then re-run the doctor to confirm the tree is clean.',
].join('\n')

/**
 * Produce a report-only DoctorFinding per TruffleHog hit (never auto-fixable —
 * secret rotation + history rewrite is a human decision). Verified hits are
 * ranked first.
 */
export function formatSecretFindings(
  hits: readonly TruffleHogHit[],
): DoctorFinding[] {
  return sortHits(hits).map(hit => {
    const at = hit.line === undefined ? hit.file : `${hit.file}:${hit.line}`
    const status = hit.verified
      ? 'VERIFIED live credential'
      : 'unverified pattern match'
    return {
      fix: ROTATE_FIX,
      fixable: false,
      saw: `TruffleHog ${hit.detectorName} detector flagged a ${status} in the tracked tree`,
      wanted:
        'no credentials in tracked files (secrets live in the keychain / CI secret store)',
      what: `Secret in tracked file: ${hit.detectorName} (${status})`,
      where: at,
    }
  })
}

/**
 * Report-only finding emitted when the fleet's pinned TruffleHog binary cannot
 * be resolved (the security-tools setup has not run). This keeps the probe
 * deterministic — a skip-with-notice rather than a false-green "no secrets".
 * The doctor NEVER falls back to a system/unpinned TruffleHog.
 */
export function formatToolMissingFinding(): DoctorFinding {
  return {
    fix: [
      'Install the fleet security tools so the pinned, sha512-verified',
      'TruffleHog binary is available:',
      '',
      '  pnpm run setup            # from-scratch: installs uv, TruffleHog, …',
      '',
      'Then re-run the doctor. The doctor deliberately does NOT use a system',
      'TruffleHog — only the fleet-pinned binary (TruffleHog has been',
      'supply-chain-compromised in the past; the pin + integrity is the gate).',
    ].join('\n'),
    fixable: false,
    saw: 'the fleet-pinned TruffleHog binary is not installed (secret scan skipped, NOT confirmed clean)',
    wanted:
      'the fleet-pinned TruffleHog binary installed by setup-security-tools',
    what: 'Secret scan skipped: fleet TruffleHog unavailable',
    where:
      '.claude/hooks/fleet/setup-security-tools/external-tools.json (trufflehog)',
  }
}
