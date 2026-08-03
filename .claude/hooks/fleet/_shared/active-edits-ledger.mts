/*
 * @file Active-edits ledger — per-actor edit timestamps, keyed by transcript
 *   path. Three responsibilities:
 *
 *   1. `computeActorId(transcriptPath)` — the stable actor identifier. Keyed
 *      by transcript_path: subagent / workflow-agent turns each get their own
 *      JSONL file (e.g. `agent-<uuid>.jsonl`) while the main session uses the
 *      top-level `<session>.jsonl`. Hashing it to 16 hex chars gives a safe,
 *      fixed-length filesystem key with no personally-identifiable path content.
 *
 *   2. Pure ledger core (`pruneLedger`, `isActorLive`, `lookupPath`) — all
 *      IO-free so tests run without a real filesystem or clock.
 *
 *   3. Thin fs shell (`readActorLedger`, `writeActorLedger`,
 *      `listOtherActorLedgerPaths`, `sweepStaleLedgers`) — wraps the pure
 *      core with real disk IO under `.cache/fleet/socket-active-edits/`
 *      (dep-0 runtime-state store; never tracked).
 *
 * Fail-open contract: every function returns a safe default on IO / parse
 * errors. A broken ledger must never block a tool call.
 */

import crypto from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { resolveRepoRoot } from './repo-root.mts'

// TTL after which a ledger file is considered stale, actor exited or idle.
// 15 minutes — generous enough for a slow turn; tight enough to not persist
// across the next session started in the same project.
export const LEDGER_TTL_MS = 15 * 60 * 1000

// Collision window: a path written within this window by a live foreign actor
// is considered in-flight. 5 minutes covers slow multi-step edits.
export const COLLISION_WINDOW_MS = 5 * 60 * 1000

// Liveness window for a background child (a spawned subagent / Agent-tool run):
// its transcript file is appended to on every tool call, so a fresh mtime marks
// it as still running. Generous enough to span a child mid-build (which may not
// touch its transcript for a bit), tight enough that a finished child stops
// shielding within a few minutes. The dirty-worktree stop-guard uses this to
// defer, not block, when a live child is still producing in-flight edits — see
// `deriveSubagentsDir` / `hasLiveBackgroundChild`.
export const CHILD_LIVE_WINDOW_MS = 5 * 60 * 1000

// Store location: `.cache/<store>` — dep-0 runtime state, never
// tracked. Falls back to OS temp when .cache is unavailable.
const STORE_NAME = 'socket-active-edits'

/**
 * The on-disk shape for one actor's ledger. `paths` maps ABSOLUTE normalized
 * path (see normalizeForLedger) → last-write epoch (ms). `updatedAt` is the
 * ledger's own last-flush time — used for TTL of the whole file.
 */
export interface ActorLedger {
  readonly actorId: string
  // Nameable metadata, best-effort, local-only runtime state: the
  // recording process pid and the transcript basename, so a collision
  // message or whose-work can say WHICH session owns a path instead of
  // an opaque hash. Absent on pre-metadata ledgers.
  readonly pid?: number | undefined
  readonly label?: string | undefined
  readonly paths: Record<string, number>
  // Optional per-path provenance: how the write was observed. Absent →
  // 'edit' (the Edit/Write/NotebookEdit recorder). 'bash' → inferred from
  // a write-capable Bash command, fixer, formatter, install, codegen, by
  // the bash recorder — a weaker authorship signal consumers may treat
  // differently, a fixer touching a peer's file is not authorship.
  readonly via?: Record<string, string> | undefined
  readonly updatedAt: number
}

/**
 * Derive a stable actor ID from a transcript path. Discriminates SEPARATE
 * interactive sessions (each top-level session has its own `.jsonl`), which is
 * the parallel-session case the ledger coordinates.
 *
 * NOTE it does NOT discriminate a spawned subagent from its parent: Claude Code
 * delivers the PARENT session's `transcript_path` to PostToolUse hooks even for
 * a subagent's Edit/Write, so a subagent's writes collapse into the parent
 * actor's ledger. A subagent still has its own on-disk transcript
 * (`<session>/subagents/agent-<id>.jsonl`); the stop-guard detects a live child
 * from that directory (`hasLiveBackgroundChild`) rather than from the ledger.
 *
 * Returns `undefined` when there is no transcript path to key on — callers
 * skip the ledger in that case.
 */
export function computeActorId(
  transcriptPath: string | undefined,
): string | undefined {
  if (!transcriptPath) {
    return undefined
  }
  return crypto
    .createHash('sha256')
    .update(transcriptPath)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Resolve the cache store root. Prefers
 * `<repo root of projectDir>/.cache/<store>` when a project dir
 * is available; falls back to the OS temp dir. The git-toplevel anchor is
 * what keeps every caller on ONE store instead of scattering a `.cache/`
 * per cwd — including one inside `template/base/`, the cascade payload
 * (see repo-root.mts).
 */
export function resolveStoreRoot(projectDir: string | undefined): string {
  if (projectDir) {
    return path.join(resolveRepoRoot(projectDir), '.cache', 'fleet', STORE_NAME)
  }
  return path.join(
    process.env['TMPDIR'] ??
      process.env['TMP'] ??
      process.env['TEMP'] ??
      '/tmp',
    STORE_NAME,
  )
}

/**
 * Resolve the ledger file path for a given actor ID + store root.
 */
export function ledgerFilePath(storeRoot: string, actorId: string): string {
  return path.join(storeRoot, `${actorId}.json`)
}

// ── Pure ledger core ──────────────────────────────────────────────────────

/**
 * Prune stale path entries. Returns a new ledger with entries older than
 * `ttlMs` removed, or `undefined` when the ledger itself is stale (updatedAt
 * older than ttlMs). Pure — no IO, injectable clock.
 */
export function pruneLedger(
  ledger: ActorLedger,
  config: { now: number; ttlMs: number },
): ActorLedger | undefined {
  const { now, ttlMs } = { __proto__: null, ...config } as typeof config
  if (now - ledger.updatedAt > ttlMs) {
    return undefined
  }
  const pruned: Record<string, number> = {}
  const prunedVia: Record<string, string> = {}
  const threshold = now - ttlMs
  for (const [p, ts] of Object.entries(ledger.paths)) {
    if (ts >= threshold) {
      pruned[p] = ts
      const via = ledger.via?.[p]
      if (via) {
        prunedVia[p] = via
      }
    }
  }
  return {
    actorId: ledger.actorId,
    paths: pruned,
    ...(Object.keys(prunedVia).length ? { via: prunedVia } : {}),
    updatedAt: ledger.updatedAt,
  }
}

/**
 * The subagents transcript directory for a session, derived from its top-level
 * transcript path: `<dir>/<session>.jsonl` → `<dir>/<session>/subagents`. That
 * is where Claude Code writes each spawned subagent's own transcript
 * (`agent-<id>.jsonl`). Returns `undefined` when the path isn't a `.jsonl`
 * transcript. Pure — no IO.
 */
export function deriveSubagentsDir(
  transcriptPath: string | undefined,
): string | undefined {
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) {
    return undefined
  }
  const dir = path.dirname(transcriptPath)
  const session = path.basename(transcriptPath, '.jsonl')
  return path.join(dir, session, 'subagents')
}

/**
 * True when any of the given transcript mtimes is fresh within `windowMs` of
 * `now` — i.e. a spawned child is still appending to its transcript and so is
 * considered live. Pure — no IO, injectable clock.
 */
export function hasLiveChildMtime(
  mtimes: readonly number[],
  config: { now: number; windowMs: number },
): boolean {
  const { now, windowMs } = { __proto__: null, ...config } as typeof config
  for (let i = 0, { length } = mtimes; i < length; i += 1) {
    if (now - mtimes[i]! <= windowMs) {
      return true
    }
  }
  return false
}

/**
 * True when a ledger is "live" — its updatedAt is fresh within ttlMs of now.
 * Pure — no IO, injectable clock.
 */
export function isActorLive(
  ledger: ActorLedger,
  config: { now: number; ttlMs: number },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  return cfg.now - ledger.updatedAt <= cfg.ttlMs
}

/**
 * Returns the epoch-ms timestamp of the last write to `normalizedPath` in the
 * given ledger, or `undefined` if the path is not present. Pure.
 */
export function lookupPath(
  ledger: ActorLedger,
  normalizedPath: string,
): number | undefined {
  return ledger.paths[normalizedPath]
}

export interface DirtyAttribution {
  readonly owner: 'own' | 'foreign-live' | 'foreign-stale' | 'unknown'
  readonly actorId?: string | undefined
  readonly actorLabel?: string | undefined
  readonly actorPid?: number | undefined
  readonly ageMs?: number | undefined
  readonly via?: string | undefined
}

/**
 * Attribute one dirty path across the actor ledgers: the most-recent
 * writer wins. Foreign beats own only when STRICTLY newer (a tie or an
 * own-later write is own work); 'foreign-live' vs 'foreign-stale' splits
 * on the winning ledger's liveness. 'unknown' = no ledger ever recorded
 * the path (a human's edit, a pre-ledger write, or a Bash write the
 * recorder's heuristics missed). This is the single attribution loop the
 * stop guard blocks on and whose-work reports from — one implementation,
 * so a path the guard sanctions is never one whose-work calls yours.
 */
export function attributeDirtyPath(
  normalizedPath: string,
  ownLedger: ActorLedger | undefined,
  foreignLedgers: ReadonlyArray<ActorLedger | undefined>,
  config: { now: number },
): DirtyAttribution {
  const cfg = { __proto__: null, ...config } as typeof config
  const ownWrite = ownLedger ? lookupPath(ownLedger, normalizedPath) : undefined
  let latestTs: number | undefined
  let latestLedger: ActorLedger | undefined
  for (let j = 0, { length } = foreignLedgers; j < length; j += 1) {
    const ledger = foreignLedgers[j]
    if (!ledger) {
      continue
    }
    const lastWrite = lookupPath(ledger, normalizedPath)
    if (
      lastWrite !== undefined &&
      (latestTs === undefined || lastWrite > latestTs)
    ) {
      latestTs = lastWrite
      latestLedger = ledger
    }
  }
  const foreignIsNewer =
    latestLedger !== undefined &&
    latestTs !== undefined &&
    (ownWrite === undefined || latestTs > ownWrite)
  if (foreignIsNewer) {
    const live = isActorLive(latestLedger!, {
      now: cfg.now,
      ttlMs: LEDGER_TTL_MS,
    })
    return {
      owner: live ? 'foreign-live' : 'foreign-stale',
      actorId: latestLedger!.actorId,
      actorLabel: latestLedger!.label,
      actorPid: latestLedger!.pid,
      ageMs: cfg.now - latestTs!,
      via: latestLedger!.via?.[normalizedPath],
    }
  }
  if (ownWrite !== undefined) {
    return {
      owner: 'own',
      actorId: ownLedger?.actorId,
      ageMs: cfg.now - ownWrite,
      via: ownLedger?.via?.[normalizedPath],
    }
  }
  return { owner: 'unknown' }
}

/**
 * Produce a new ledger with `normalizedPath` recorded at `now`. Carries
 * forward existing non-stale entries. Pure — no IO.
 */
export function recordPath(
  existing: ActorLedger | undefined,
  actorId: string,
  normalizedPath: string,
  config: { now: number; ttlMs: number; via?: string | undefined },
): ActorLedger {
  const { now, ttlMs, via } = { __proto__: null, ...config } as typeof config
  const base = existing ? pruneLedger(existing, { now, ttlMs }) : undefined
  const paths: Record<string, number> = { ...(base?.paths ?? {}) }
  paths[normalizedPath] = now
  const viaMap: Record<string, string> = { ...(base?.via ?? {}) }
  if (via) {
    viaMap[normalizedPath] = via
  } else {
    // A direct Edit/Write supersedes weaker provenance for the path.
    delete viaMap[normalizedPath]
  }
  return {
    actorId,
    paths,
    ...(Object.keys(viaMap).length ? { via: viaMap } : {}),
    updatedAt: now,
  }
}

// ── Thin fs shell ─────────────────────────────────────────────────────────

/**
 * Parse and return one actor's ledger from disk. Returns `undefined` on
 * missing file, parse error, or malformed shape. Fail-open.
 */
export function readActorLedger(filePath: string): ActorLedger | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.actorId !== 'string' ||
      typeof parsed.updatedAt !== 'number' ||
      !parsed.paths ||
      typeof parsed.paths !== 'object'
    ) {
      return undefined
    }
    return parsed as ActorLedger
  } catch {
    return undefined
  }
}

/**
 * Flush an actor's ledger to disk. Creates the store directory if needed.
 * Fail-open: swallows all IO errors, a broken store must not block edits.
 */
export function writeActorLedger(filePath: string, ledger: ActorLedger): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(ledger), 'utf8')
  } catch {
    // Fail-open.
  }
}

/**
 * List all actor ledger files in the store EXCEPT the one belonging to
 * `ownActorId`. Returns full file paths. Fail-open: returns empty array on
 * any IO error.
 */
export function listOtherActorLedgerPaths(
  storeRoot: string,
  ownActorId: string,
): string[] {
  try {
    if (!existsSync(storeRoot)) {
      return []
    }
    const entries = readdirSync(storeRoot)
    const out: string[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const actorId = entry.slice(0, -5)
      if (actorId === ownActorId) {
        continue
      }
      out.push(path.join(storeRoot, entry))
    }
    return out
  } catch {
    return []
  }
}

/**
 * Expire ledger files whose mtime is past `ttlMs`. Fire-and-forget; errors
 * are suppressed. Runs opportunistically from the recorder hook to bound
 * store growth.
 */
export function sweepStaleLedgers(
  storeRoot: string,
  config: { now: number; ttlMs: number },
): void {
  const { now, ttlMs } = { __proto__: null, ...config } as typeof config
  try {
    if (!existsSync(storeRoot)) {
      return
    }
    const entries = readdirSync(storeRoot)
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const fp = path.join(storeRoot, entry)
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- statSync for mtime, not just existence; we need the modification timestamp
        const stat = statSync(fp)
        if (now - stat.mtimeMs > ttlMs) {
          safeDeleteSync(fp)
        }
      } catch {
        // Fail-open per file.
      }
    }
  } catch {
    // Fail-open for the whole sweep.
  }
}

/**
 * List the mtimes, epoch ms, of every direct subagent transcript
 * (`agent-*.jsonl`) in `subagentsDir`. Non-recursive on purpose: a spawned
 * subagent's transcript sits directly under `subagents/`, while a background
 * WORKFLOW's agents nest under `subagents/workflows/<run>/` and are excluded —
 * a workflow typically runs in another repo / worktree, so it must not shield
 * dirt in THIS checkout. `.meta.json` companions are skipped. Fail-open:
 * returns an empty array on any IO error.
 */
export function listChildTranscriptMtimes(subagentsDir: string): number[] {
  try {
    if (!existsSync(subagentsDir)) {
      return []
    }
    const entries = readdirSync(subagentsDir)
    const out: number[] = []
    for (const entry of entries) {
      if (!entry.startsWith('agent-') || !entry.endsWith('.jsonl')) {
        continue
      }
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- statSync for mtime, not just existence; we need the modification timestamp
        out.push(statSync(path.join(subagentsDir, entry)).mtimeMs)
      } catch {
        // Fail-open per file.
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * True when the session owning `transcriptPath` has a live background child —
 * a spawned subagent whose transcript was appended to within `windowMs`. Used
 * by the dirty-worktree stop-guard to DEFER, not block, when an in-flight child
 * may still be producing edits: the child's completion notification re-invokes
 * the session to land the work. Fail-open: `false` on any resolution error.
 */
export function hasLiveBackgroundChild(
  transcriptPath: string | undefined,
  config: { now: number; windowMs: number },
): boolean {
  const subagentsDir = deriveSubagentsDir(transcriptPath)
  if (!subagentsDir) {
    return false
  }
  return hasLiveChildMtime(listChildTranscriptMtimes(subagentsDir), config)
}

/**
 * Normalize an absolute file path for use as a ledger key. Consistent with the
 * fleet rule: always normalize before comparing.
 */
export function normalizeForLedger(absPath: string): string {
  return normalizePath(absPath)
}
