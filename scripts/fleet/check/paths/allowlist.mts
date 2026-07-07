/**
 * @file Allowlist parsing + matching for the path-hygiene gate. Loads
 *   `pathsAllowlist` from the fleet's canonical
 *   `.config/socket-wheelhouse.json` (JSON, not YAML, per the "JSON not YAML
 *   for our own configs" rule). `snippetHash` produces a
 *   whitespace-insensitive, 12-hex-char SHA-256 prefix used as a drift-tolerant
 *   key in allowlist entries. `isAllowlisted` matches a finding against any
 *   combination of `rule` / `file` / `pattern` / `line` / `snippet_hash`
 *   filters; the line/hash check is OR'd so reformatting that shifts the line
 *   still matches via the hash.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AllowlistEntry, Finding } from './types.mts'

/**
 * Read `pathsAllowlist` from the fleet's canonical `socket-wheelhouse.json`
 * (primary under `.config/`, legacy root-level dotfile as a secondary
 * location). Returns `[]` when the config is absent, has no `pathsAllowlist`
 * key, or the key is empty. `reason` is required per entry; bad shapes are
 * dropped with a stderr note rather than blowing up the whole gate.
 */
export const loadAllowlist = (repoRoot: string): AllowlistEntry[] => {
  // Two accepted locations match the rest of the fleet's
  // socket-wheelhouse.json resolution: primary under .config/ and
  // legacy root-level dotfile.
  const candidates = [
    path.join(repoRoot, '.config', 'socket-wheelhouse.json'),
    path.join(repoRoot, '.socket-wheelhouse.json'),
  ]
  let configPath: string | undefined
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const c = candidates[i]!
    if (existsSync(c)) {
      configPath = c
      break
    }
  }
  if (!configPath) {
    return []
  }
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return []
  }
  let cfg: { pathsAllowlist?: unknown | undefined }
  try {
    cfg = JSON.parse(raw)
  } catch {
    return []
  }
  const arr = cfg.pathsAllowlist
  if (arr === undefined) {
    return []
  }
  if (!Array.isArray(arr)) {
    process.stderr.write(
      `[check-paths-are-canonical] pathsAllowlist in ${configPath} must be an array; ignoring.\n`,
    )
    return []
  }
  const out: AllowlistEntry[] = []
  for (let i = 0; i < arr.length; i += 1) {
    const e = arr[i]!
    if (typeof e !== 'object' || e === null) {
      process.stderr.write(
        `[check-paths-are-canonical] pathsAllowlist[${i}] in ${configPath} is not an object; skipping.\n`,
      )
      continue
    }
    const obj = e as Record<string, unknown>
    if (typeof obj['reason'] !== 'string' || obj['reason'].length === 0) {
      process.stderr.write(
        `[check-paths-are-canonical] pathsAllowlist[${i}] in ${configPath} missing required \`reason\`; skipping.\n`,
      )
      continue
    }
    const entry: AllowlistEntry = { reason: obj['reason'] }
    if (typeof obj['file'] === 'string') {
      entry.file = obj['file']
    }
    if (typeof obj['pattern'] === 'string') {
      entry.pattern = obj['pattern']
    }
    if (typeof obj['rule'] === 'string') {
      entry.rule = obj['rule']
    }
    if (typeof obj['line'] === 'number') {
      entry.line = obj['line']
    }
    if (typeof obj['snippet_hash'] === 'string') {
      entry.snippet_hash = obj['snippet_hash']
    }
    out.push(entry)
  }
  return out
}

/**
 * Stable, normalized snippet hash. Whitespace-insensitive so trivial
 * reformatting (indent change, trailing comma, line wrap) doesn't invalidate an
 * allowlist entry, but content-changing edits do. The hash exposes only the
 * first 12 hex chars (~48 bits) which is plenty for collision-resistance within
 * a single repo's finding set and keeps the config entry readable.
 */
export const snippetHash = (snippet: string): string => {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 12)
}

/**
 * Allowlist matching trades off two failure modes:
 *
 * - Drift via reformatting (a line shift breaks an entry, the finding
 *   re-surfaces, devs paper over with a new entry).
 * - Stealth allowlisting (an entry pinned to "anywhere in this file" silently
 *   exempts unrelated future violations).
 *
 * Strategy: exact line match OR `snippet_hash` match (whitespace- normalized
 * SHA-256, first 12 hex). Either is sufficient. Lines stay exact (was ±2; the
 * slack let reformatting silently slide), and `snippet_hash` provides
 * reformatting-tolerant matching that's still tied to the literal text —
 * paste-and-edit cheating would change the hash. If neither `line` nor
 * `snippet_hash` is provided, the entry matches purely by `rule` + `file` +
 * `pattern` (file-level exempt; use sparingly and always pair with a precise
 * `pattern`).
 */
export const isAllowlisted = (
  finding: Finding,
  allowlist: readonly AllowlistEntry[],
): boolean =>
  allowlist.some(entry => {
    if (entry.rule && entry.rule !== finding.rule) {
      return false
    }
    if (entry.file && !finding.file.includes(entry.file)) {
      return false
    }
    if (entry.pattern && !finding.snippet.includes(entry.pattern)) {
      return false
    }
    const lineProvided = entry.line !== undefined
    const hashProvided =
      typeof entry.snippet_hash === 'string' && entry.snippet_hash.length > 0
    if (lineProvided || hashProvided) {
      const lineMatches = lineProvided && entry.line === finding.line
      const hashMatches =
        hashProvided && entry.snippet_hash === snippetHash(finding.snippet)
      if (!(lineMatches || hashMatches)) {
        return false
      }
    }
    return true
  })
