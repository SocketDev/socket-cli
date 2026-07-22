/*
 * @file Dep-0 lock-step release-cascade logic for the fleet bundle fetcher.
 *   Holds the PURE comparison + state-resolution + validation + error/notice
 *   formatting so the fetch-path verify, the `--status` verb, and the unit
 *   tests share one implementation. Built (inlined) into the single distributed
 *   `bootstrap/fleet.mjs`. Zero deps beyond node: builtins + the lib-stable
 *   logger (never the in-repo socket-lib).
 *
 *   LOCK-STEP INVARIANT: a member's pinned `bundle.cascadeSha` (the wheelhouse
 *   template SHA the last commit-cascade landed) MUST equal the `templateSha`
 *   of the release at `bundle.ref`. The fetch path is `--frozen-lockfile`-style
 *   (hard-fail, never apply a mismatched release); `fleet:status` reports the
 *   three states; the passive notice fires opportunistically when a newer
 *   release exists.
 */

// socket-lint: allow source-method-order -- grouped by concern (validation →
// comparison → state-resolution → error → notice → store), mirroring the dep-0
// fetcher's call-flow rather than alphabetized.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// A fleet release tag: `fleet-<hex>` (the bundle ref pin). NO semver, NO
// `latest`/`lts`/`*` aliases, NO ranges — an exact tag only. The hex segment is
// the bundle version stamp (a short or full SHA / version stamp), so 7+ hex.
const FLEET_REF_RE = /^fleet-[0-9a-f]{7,}$/
// A bare full-length git SHA — exactly 40 lowercase hex chars. cascadeSha is the
// wheelhouse template commit the cascade landed; it is never a range/alias.
const FULL_SHA_RE = /^[0-9a-f]{40}$/
// A fuzzy/ranged/aliased ref token a pin must NEVER carry (defense-in-depth
// alongside the shape regex — names the offending construct in the error).
const FUZZY_REF_RE = /[\^~*]|\b(?:canary|head|latest|lts|main|master|next)\b/i

export type LockStepStateName = 'current' | 'out-of-sync' | 'update-available'

export interface LockStepConfig {
  // The pinned release tag (`bundle.ref`).
  readonly ref: string
  // The wheelhouse template SHA the last cascade landed (`bundle.cascadeSha`).
  readonly cascadeSha: string
}

export interface LockStepInputs {
  // The pinned config (ref + cascadeSha).
  readonly config: LockStepConfig
  // The `templateSha` of the release AT `config.ref` (resolved from its
  // manifest / release asset). undefined when the ref's release can't be found.
  readonly pinnedTemplateSha: string | undefined
  // The `templateSha` of the NEWEST release (resolved via `gh release list`).
  // undefined when unknown (offline / not resolvable) — the status verb then
  // omits the Newest column rather than guessing.
  readonly newestTemplateSha: string | undefined
  // The newest release's tag — named in the "re-cascade to <ref>" line.
  readonly newestRef: string | undefined
}

export interface LockStepState {
  readonly state: LockStepStateName
  // True when the pin's invariant is intact (cascadeSha === pinnedTemplateSha).
  readonly inLockStep: boolean
  // True when a newer release exists than the pinned one.
  readonly updateAvailable: boolean
  readonly config: LockStepConfig
  readonly pinnedTemplateSha: string | undefined
  readonly newestTemplateSha: string | undefined
  readonly newestRef: string | undefined
}

export interface RefValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/**
 * Validate a `bundle.ref` value at WRITE time. Rejects an empty, fuzzy, ranged,
 * or aliased ref — only an exact `fleet-<hex>` tag is legal. Returns the list
 * of problems (empty === valid).
 */
export function validateRef(ref: unknown): RefValidation {
  const errors: string[] = []
  if (typeof ref !== 'string' || ref.length === 0) {
    errors.push('`bundle.ref` must be a non-empty string.')
    return { ok: false, errors }
  }
  if (FUZZY_REF_RE.test(ref)) {
    errors.push(
      `\`bundle.ref\` must be an exact \`fleet-<hex>\` tag — no range/alias ` +
        `(\`^\` \`~\` \`*\` \`latest\` \`lts\` \`main\` …); got ${JSON.stringify(ref)}.`,
    )
  }
  if (!FLEET_REF_RE.test(ref)) {
    errors.push(
      `\`bundle.ref\` must match ${String(FLEET_REF_RE)} (a \`fleet-<hex>\` ` +
        `release tag); got ${JSON.stringify(ref)}.`,
    )
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Validate a `bundle.cascadeSha` value at WRITE time. Rejects anything that is
 * not a bare 40-char lowercase hex SHA (no `v` prefix, no range, no alias).
 */
export function validateCascadeSha(cascadeSha: unknown): RefValidation {
  const errors: string[] = []
  if (typeof cascadeSha !== 'string' || cascadeSha.length === 0) {
    errors.push('`bundle.cascadeSha` must be a non-empty string.')
    return { ok: false, errors }
  }
  if (!FULL_SHA_RE.test(cascadeSha)) {
    errors.push(
      `\`bundle.cascadeSha\` must be a bare full-length git SHA ` +
        `(40 lowercase hex chars); got ${JSON.stringify(cascadeSha)}.`,
    )
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Validate a complete `bundle` block (both fields together). Used by the
 * write-time gate in the config reader + the cascade stamper.
 */
export function validateBundleBlock(bundle: unknown): RefValidation {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    return { ok: false, errors: ['`bundle` must be an object.'] }
  }
  const b = bundle as {
    ref?: unknown | undefined
    cascadeSha?: unknown | undefined
  }
  const refResult = validateRef(b.ref)
  const shaResult = validateCascadeSha(b.cascadeSha)
  const errors = [...refResult.errors, ...shaResult.errors]
  return { ok: errors.length === 0, errors }
}

/**
 * Resolve the lock-step state from the PARSED inputs (never a substring scan).
 * Pure — no IO — so the three states + their exit codes unit-test offline.
 *
 * - CURRENT: inLockStep AND no newer release.
 * - UPDATE-AVAILABLE: inLockStep but a newer release exists.
 * - OUT-OF-SYNC: cascadeSha !== pinnedTemplateSha (broken invariant).
 *
 * When `pinnedTemplateSha` is undefined (the ref's release can't be found) the
 * invariant cannot be confirmed, so the state is OUT-OF-SYNC — fail loud rather
 * than assume current.
 */
export function resolveLockStepState(inputs: LockStepInputs): LockStepState {
  const { config, newestRef, newestTemplateSha, pinnedTemplateSha } = inputs
  const inLockStep =
    pinnedTemplateSha !== undefined && config.cascadeSha === pinnedTemplateSha
  const updateAvailable =
    inLockStep &&
    newestTemplateSha !== undefined &&
    newestTemplateSha !== pinnedTemplateSha
  let state: LockStepStateName
  if (!inLockStep) {
    state = 'out-of-sync'
  } else if (updateAvailable) {
    state = 'update-available'
  } else {
    state = 'current'
  }
  return {
    config,
    inLockStep,
    newestRef,
    newestTemplateSha,
    pinnedTemplateSha,
    state,
    updateAvailable,
  }
}

/**
 * The terraform `-detailed-exitcode`-style exit code for a resolved state.
 * 0  CURRENT, or UPDATE-AVAILABLE without --exit-code.
 * 10 UPDATE-AVAILABLE WITH --exit-code (a clean "drift detected" signal).
 * 1  OUT-OF-SYNC — ALWAYS (broken invariant, fail loud regardless of flags).
 */
export function lockStepExitCode(
  state: LockStepState,
  options?: { exitCode?: boolean | undefined } | undefined,
): number {
  const opts = { __proto__: null, ...options } as typeof options
  if (state.state === 'out-of-sync') {
    return 1
  }
  if (state.state === 'update-available') {
    return opts?.exitCode ? 10 : 0
  }
  return 0
}

export const ERR_LOCKSTEP_MISMATCH = 'ERR_WHEELHOUSE_LOCKSTEP_MISMATCH'

export interface LockStepErrorParts {
  readonly ref: string
  readonly pinnedTemplateSha: string | undefined
  readonly cascadeSha: string
}

/**
 * Build the pnpm-style lock-step mismatch error from the PARSED fields (never
 * stitched from substrings). Lines: code + What / Where / Wanted / Saw / Fix.
 * Prints BOTH the raw ref and the resolved release templateSha so the operator
 * can see which side drifted.
 */
export function formatLockStepError(parts: LockStepErrorParts): string {
  const { cascadeSha, pinnedTemplateSha, ref } = parts
  const sawTemplate =
    pinnedTemplateSha === undefined
      ? 'no release found at that ref'
      : `release templateSha ${pinnedTemplateSha}`
  return [
    `${ERR_LOCKSTEP_MISMATCH}  the pinned bundle is out of lock-step.`,
    `  What:   bundle out of lock-step — the pinned release and the cascaded template SHA disagree.`,
    `  Where:  .config/repo/socket-wheelhouse.json (bundle.ref + bundle.cascadeSha).`,
    `  Wanted: bundle.cascadeSha === templateSha of the release at bundle.ref.`,
    `  Saw:    ref = ${ref} (${sawTemplate}), cascadeSha = ${cascadeSha}.`,
    `  Fix:    re-cascade to the pin — \`node scripts/repo/sync-scaffolding/cli.mts --target . --fix\` —` +
      ` OR re-pin bundle.ref to the release whose templateSha is ${cascadeSha}.`,
  ].join('\n')
}

// ── Passive update notice (update-notifier style) ──────────────────────────────

// Out-of-tree runtime store for the dep-0 fetcher: node_modules/.cache/ is the
// standard tool-cache home (gitignored via node_modules, never the tracked
// tree). Holds the last-check timestamp + last-seen ref so the notice throttles
// to once per 24h. See docs/agents.md/fleet/runtime-state-and-caches.md.
const NOTICE_STORE_REL =
  'node_modules/.cache/socket-wheelhouse/update-notice.json'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
export const UPDATE_NOTIFIER_OPT_OUT_ENV = 'WHEELHOUSE_NO_UPDATE_NOTIFIER'

export interface NoticeStore {
  readonly lastCheckMs: number
  readonly lastSeenRef: string | undefined
}

export function readNoticeStore(dest: string): NoticeStore | undefined {
  const p = path.join(dest, NOTICE_STORE_REL)
  if (!existsSync(p)) {
    return undefined
  }
  try {
    const json = JSON.parse(readFileSync(p, 'utf8')) as {
      lastCheckMs?: unknown | undefined
      lastSeenRef?: unknown | undefined
    }
    return {
      lastCheckMs: typeof json.lastCheckMs === 'number' ? json.lastCheckMs : 0,
      lastSeenRef:
        typeof json.lastSeenRef === 'string' ? json.lastSeenRef : undefined,
    }
  } catch {
    return undefined
  }
}

export function writeNoticeStore(dest: string, store: NoticeStore): void {
  const p = path.join(dest, NOTICE_STORE_REL)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(
    p,
    `${JSON.stringify({ lastCheckMs: store.lastCheckMs, lastSeenRef: store.lastSeenRef }, undefined, 2)}\n`,
  )
}

export interface NoticeDecisionInputs {
  // Whether a newer release than the pinned one exists.
  readonly updateAvailable: boolean
  // The newest release tag (named in the notice).
  readonly newestRef: string | undefined
  // The throttle store's last check, or undefined for a first run.
  readonly store: NoticeStore | undefined
  // Current wall-clock millis (injected so the throttle unit-tests offline).
  readonly nowMs: number
  // process.env.CI presence (notice suppressed in CI).
  readonly ci: boolean
  // WHEELHOUSE_NO_UPDATE_NOTIFIER=1 presence (passive notice opt-out ONLY).
  readonly optedOut: boolean
}

/**
 * Decide whether the passive update notice should print. Pure so the throttle +
 * CI-suppress + opt-out unit-test offline. The notice fires only when: a newer
 * release exists, we are NOT in CI, NOT opted out, and either the store is
 * empty, ≥24h have passed since the last check, OR the newest ref changed since
 * last seen (a fresh release jumps the throttle).
 */
export function shouldShowNotice(inputs: NoticeDecisionInputs): boolean {
  const { ci, newestRef, nowMs, optedOut, store, updateAvailable } = inputs
  if (!updateAvailable || ci || optedOut || newestRef === undefined) {
    return false
  }
  if (store === undefined) {
    return true
  }
  if (store.lastSeenRef !== newestRef) {
    return true
  }
  return nowMs - store.lastCheckMs >= TWENTY_FOUR_HOURS_MS
}

/**
 * Format the boxed passive notice. NAMES the re-cascade as the action (never a
 * bare re-fetch). Honors NO_COLOR by dropping the box-drawing emphasis to plain
 * ASCII when `color` is false.
 */
export function formatUpdateNotice(options: {
  readonly newestRef: string
  readonly color: boolean
}): string {
  const { color, newestRef } = { __proto__: null, ...options } as typeof options
  const lines = [
    'A newer fleet scaffolding release is available.',
    `Re-cascade to ${newestRef}:`,
    'node scripts/repo/sync-scaffolding/cli.mts --target . --fix',
  ]
  if (!color) {
    return lines.map(l => `  ${l}`).join('\n')
  }
  const width = Math.max(...lines.map(l => l.length))
  const top = `╭${'─'.repeat(width + 2)}╮`
  const bottom = `╰${'─'.repeat(width + 2)}╯`
  const body = lines.map(l => `│ ${l.padEnd(width)} │`)
  return [top, ...body, bottom].join('\n')
}
