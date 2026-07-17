/*
 * @file Learning ledger — a deterministic, cross-session recurrence counter for
 *   the codification discipline. The existing lesson nudges
 *   (`compound-lessons-nudge`, `uncodified-lesson-nudge`) only see the CURRENT
 *   transcript, so a mistake that recurs on Tuesday and again Friday reads as
 *   two isolated one-offs. This ledger records a normalized key per
 *   correction/lesson and counts how often it recurs ACROSS sessions, so a
 *   nudge can escalate on evidence ("seen 3× — codify it") instead of prose.
 *
 *   Adopted from the fleet-compatible half of Caliber (../ai-setup): the
 *   `occurrences` counter, the string-similarity dedup, the correction-phrase
 *   heuristic, and the typed-bullet taxonomy. Caliber's LLM distillation,
 *   PostHog telemetry, and SessionEnd self-spawn are deliberately NOT adopted —
 *   detection here is regex + counters only, storage is local, nothing hits the
 *   network or an LLM.
 *
 *   Three parts (mirrors active-edits-ledger's split so tests run IO-free):
 *   1. Taxonomy + pure text ops (`normalizeLearning`, `isSimilarLearning`).
 *   2. Pure correction-signal detection (`detectCorrectionSignal`).
 *   3. Thin fs shell (`recordOccurrence`, `readLedger`, `pruneLedger`) over a
 *      dep-0 runtime-state store at `node_modules/.cache/socket-learning-ledger/`
 *      — never tracked; OS-temp fallback.
 *
 *   Fail-open contract: every fs function returns a safe default on IO / parse
 *   errors. A broken ledger must never block a tool call or a Stop hook.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// The canonical learning taxonomy. Caliber ships two divergent vocabularies
// (an auto-distill set and a manual `save-learning` set); this reconciles them
// into ONE, taking the auto set (marked authoritative in its prompt) as the
// base and folding in the one genuinely distinct manual kind (`anti-pattern`).
// `correction` is the highest-value signal — a human overriding the agent.
export const LEARNING_TYPES = [
  'anti-pattern',
  'convention',
  'correction',
  'env',
  'fix',
  'gotcha',
  'pattern',
] as const

export type LearningType = (typeof LEARNING_TYPES)[number]

// Recurrence at or above this count is the "codify it now" threshold: the same
// normalized lesson seen in two distinct sessions is no longer a one-off.
export const RECURRENCE_THRESHOLD = 2

// TTL for a whole ledger file: entries older than this are pruned, and a ledger
// whose newest entry is older is discarded. 90 days — long enough to catch a
// genuinely recurring trap across weeks, short enough not to hoard forever.
export const LEDGER_TTL_MS = 90 * 24 * 60 * 60 * 1000

const STORE_NAME = 'socket-learning-ledger'

// ── Taxonomy + pure text ops ────────────────────────────────────────────────

const TYPE_PREFIX_RE = /^\s*(?:[-*]\s*)?\*\*\[[a-z-]+\]\*\*\s*/i
const LIST_MARKER_RE = /^\s*[-*]\s+/
const CODE_SPAN_RE = /`[^`]*`/g
const WHITESPACE_RE = /\s+/g

/**
 * Normalize a lesson/bullet to a stable comparison key: drop the list marker,
 * drop a leading `**[type]**` prefix, strip backtick code spans (identifiers
 * vary run-to-run), lowercase, collapse whitespace. Pure.
 */
export function normalizeLearning(text: string): string {
  return text
    .replace(TYPE_PREFIX_RE, '')
    .replace(LIST_MARKER_RE, '')
    .replace(CODE_SPAN_RE, '')
    .toLowerCase()
    .replace(WHITESPACE_RE, ' ')
    .trim()
}

/**
 * Two lessons are "the same" when, after normalization, the shorter is a
 * substring of the longer AND their length ratio clears the threshold. A cheap,
 * deterministic near-duplicate test — no embeddings, no LLM. Empty strings
 * never match (a blank key must not collapse every entry).
 */
export function isSimilarLearning(
  a: string,
  b: string,
  threshold = 0.7,
): boolean {
  const na = normalizeLearning(a)
  const nb = normalizeLearning(b)
  if (!na || !nb) {
    return false
  }
  if (na === nb) {
    return true
  }
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (!longer.includes(shorter)) {
    return false
  }
  return shorter.length / longer.length > threshold
}

// ── Pure correction-signal detection ────────────────────────────────────────

// Phrases that mark a human OVERRIDING the agent — the highest-value codify
// signal (adopted from Caliber's correction detector). Regex only; the LLM in
// Caliber only refined wording, never did the detection.
export const CORRECTION_PHRASE_PATTERNS: readonly RegExp[] = [
  /\bno,?\s+(?:use|do|don'?t|not)\b/i,
  /\b(?:use|do)\s+\w[\w-]*\s+instead\s+of\b/i,
  /\bdon'?t\s+(?:touch|edit|modify|change|use)\b/i,
  /\b(?:that'?s|this\s+is)\s+wrong\b/i,
  /\b(?:always|never)\s+\w[\w -]*\b(?:in\s+(?:this|the)\s+(?:repo|project|fleet)|here)\b/i,
  /\bstop,?\s+(?:that|this)\b/i,
  /\bactually,?\s+(?:use|do|it'?s|the)\b/i,
] as const

/**
 * True when text reads as a human correction of the agent. Pure.
 */
export function detectCorrectionSignal(text: string): boolean {
  for (let i = 0, { length } = CORRECTION_PHRASE_PATTERNS; i < length; i += 1) {
    if (CORRECTION_PHRASE_PATTERNS[i]!.test(text)) {
      return true
    }
  }
  return false
}

// ── Ledger shape + pure core ────────────────────────────────────────────────

/**
 * One recorded lesson: its normalized key, an optional taxonomy type, a
 * recurrence count, the set of distinct session IDs it was seen in (so
 * re-recording within ONE session does not inflate the count), and timestamps.
 */
export interface LedgerEntry {
  readonly key: string
  readonly type?: LearningType | undefined
  readonly occurrences: number
  readonly sessions: readonly string[]
  readonly firstSeen: number
  readonly lastSeen: number
}

export interface LearningLedger {
  readonly entries: readonly LedgerEntry[]
  readonly updatedAt: number
}

const EMPTY_LEDGER: LearningLedger = { entries: [], updatedAt: 0 }

/**
 * Resolve the store root: `<projectDir>/node_modules/.cache/<store>` when a
 * project dir is available, else the OS temp dir. Pure, no IO.
 */
export function resolveStoreRoot(projectDir: string | undefined): string {
  if (projectDir) {
    return path.join(projectDir, 'node_modules', '.cache', STORE_NAME)
  }
  return path.join(
    process.env['TMPDIR'] ??
      process.env['TMP'] ??
      process.env['TEMP'] ??
      '/tmp',
    STORE_NAME,
  )
}

export function ledgerFilePath(storeRoot: string): string {
  return path.join(storeRoot, 'ledger.json')
}

/**
 * Drop entries whose lastSeen is older than ttlMs. Returns a new ledger. Pure —
 * injectable clock, no IO.
 */
export function pruneLedger(
  ledger: LearningLedger,
  options: { now: number; ttlMs: number },
): LearningLedger {
  const { now, ttlMs } = { __proto__: null, ...options } as typeof options
  const threshold = now - ttlMs
  const entries = ledger.entries.filter(e => e.lastSeen >= threshold)
  return { entries, updatedAt: ledger.updatedAt }
}

/**
 * Fold one observation into a ledger: match an existing entry by
 * `isSimilarLearning`; bump its occurrence count only when `sessionId` is new
 * to that entry (a repeat WITHIN one session is not a recurrence). Otherwise
 * append a fresh entry. Returns the new ledger AND the affected entry's current
 * occurrence count (so a caller can compare against RECURRENCE_THRESHOLD).
 * Pure.
 */
export function foldObservation(
  ledger: LearningLedger,
  observation: {
    text: string
    sessionId: string
    type?: LearningType | undefined
    now: number
  },
): { ledger: LearningLedger; occurrences: number } {
  const obs = { __proto__: null, ...observation } as typeof observation
  const key = normalizeLearning(obs.text)
  if (!key) {
    return { ledger, occurrences: 0 }
  }
  const entries = [...ledger.entries]
  const idx = entries.findIndex(e => isSimilarLearning(e.key, key))
  if (idx === -1) {
    const entry: LedgerEntry = {
      key,
      type: obs.type,
      occurrences: 1,
      sessions: [obs.sessionId],
      firstSeen: obs.now,
      lastSeen: obs.now,
    }
    entries.push(entry)
    return { ledger: { entries, updatedAt: obs.now }, occurrences: 1 }
  }
  const existing = entries[idx]!
  const seenThisSession = existing.sessions.includes(obs.sessionId)
  const occurrences = seenThisSession
    ? existing.occurrences
    : existing.occurrences + 1
  const merged: LedgerEntry = {
    key: existing.key,
    type: existing.type ?? obs.type,
    occurrences,
    sessions: seenThisSession
      ? existing.sessions
      : [...existing.sessions, obs.sessionId],
    firstSeen: existing.firstSeen,
    lastSeen: obs.now,
  }
  entries[idx] = merged
  return { ledger: { entries, updatedAt: obs.now }, occurrences }
}

// ── Thin fs shell (fail-open) ───────────────────────────────────────────────

/**
 * Read the ledger for a project dir. Returns an empty ledger on any IO / parse
 * error — a broken store must never block a hook.
 */
export function readLedger(projectDir: string | undefined): LearningLedger {
  try {
    const file = ledgerFilePath(resolveStoreRoot(projectDir))
    if (!existsSync(file)) {
      return EMPTY_LEDGER
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as LearningLedger).entries)
    ) {
      return EMPTY_LEDGER
    }
    return parsed as LearningLedger
  } catch {
    return EMPTY_LEDGER
  }
}

/**
 * Write the ledger. Best-effort: swallows IO errors (fail-open). Creates the
 * store dir if absent.
 */
export function writeLedger(
  projectDir: string | undefined,
  ledger: LearningLedger,
): void {
  try {
    const root = resolveStoreRoot(projectDir)
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true })
    }
    writeFileSync(ledgerFilePath(root), JSON.stringify(ledger), 'utf8')
  } catch {
    // Fail-open: a store that cannot be written just loses recurrence history.
  }
}

/**
 * Record one observation and return its current cross-session occurrence count.
 * Prunes stale entries on the same pass. Fail-open — returns 0 on any error.
 */
export function recordOccurrence(
  projectDir: string | undefined,
  observation: {
    text: string
    sessionId: string
    type?: LearningType | undefined
    now?: number | undefined
  },
): number {
  try {
    const obs = { __proto__: null, ...observation } as typeof observation
    const now = obs.now ?? Date.now()
    const pruned = pruneLedger(readLedger(projectDir), {
      now,
      ttlMs: LEDGER_TTL_MS,
    })
    const { ledger, occurrences } = foldObservation(pruned, {
      text: obs.text,
      sessionId: obs.sessionId,
      type: obs.type,
      now,
    })
    writeLedger(projectDir, ledger)
    return occurrences
  } catch {
    return 0
  }
}
