/**
 * @fileoverview Allowlist parsing + matching for the path-hygiene gate.
 *
 * Loads `.github/paths-allowlist.yml` with a tiny purpose-built YAML
 * subset parser (entries with scalar fields plus YAML 1.2 `|` / `>`
 * block scalars for multi-line `reason` text) so the gate stays
 * self-contained — usable inside socket-lib itself, where adding a
 * `yaml` dep would create a circular dependency.
 *
 * `snippetHash` produces a whitespace-insensitive, 12-hex-char SHA-256
 * prefix used as a drift-tolerant key in allowlist entries.
 *
 * `isAllowlisted` matches a finding against any combination of
 * `rule` / `file` / `pattern` / `line` / `snippet_hash` filters; the
 * line/hash check is OR'd so reformatting that shifts the line still
 * matches via the hash.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { AllowlistEntry, Finding } from './types.mts'

/**
 * Read `pathsAllowlist` from `.config/socket-wheelhouse.json` (the
 * fleet's canonical config file — JSON, not YAML, per the
 * "JSON not YAML for our own configs" rule). Returns `undefined`
 * when the config is absent / has no pathsAllowlist key — caller
 * falls back to the legacy `.github/paths-allowlist.yml`. Returns
 * `[]` when the key is present but empty.
 *
 * Each entry mirrors the YAML schema (rule/file/pattern/line/
 * snippet_hash/reason). `reason` is required; structural
 * validation is light — bad shapes get dropped with a stderr
 * note rather than blowing up the whole gate.
 */
const loadAllowlistFromJson = (
  repoRoot: string,
): AllowlistEntry[] | undefined => {
  // Two accepted locations match the rest of the fleet's
  // socket-wheelhouse.json resolution: primary under .config/ and
  // legacy root-level dotfile.
  const candidates = [
    path.join(repoRoot, '.config', 'socket-wheelhouse.json'),
    path.join(repoRoot, '.socket-wheelhouse.json'),
  ]
  let configPath: string | undefined
  for (const c of candidates) {
    if (existsSync(c)) {
      configPath = c
      break
    }
  }
  if (!configPath) return undefined
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return undefined
  }
  let cfg: { pathsAllowlist?: unknown }
  try {
    cfg = JSON.parse(raw)
  } catch {
    return undefined
  }
  const arr = cfg.pathsAllowlist
  if (arr === undefined) return undefined
  if (!Array.isArray(arr)) {
    process.stderr.write(
      `[check-paths] pathsAllowlist in ${configPath} must be an array; ignoring.\n`,
    )
    return []
  }
  const out: AllowlistEntry[] = []
  for (let i = 0; i < arr.length; i += 1) {
    const e = arr[i]
    if (typeof e !== 'object' || e === null) {
      process.stderr.write(
        `[check-paths] pathsAllowlist[${i}] in ${configPath} is not an object; skipping.\n`,
      )
      continue
    }
    const obj = e as Record<string, unknown>
    if (typeof obj['reason'] !== 'string' || obj['reason'].length === 0) {
      process.stderr.write(
        `[check-paths] pathsAllowlist[${i}] in ${configPath} missing required \`reason\`; skipping.\n`,
      )
      continue
    }
    const entry: AllowlistEntry = { reason: obj['reason'] }
    if (typeof obj['file'] === 'string') entry.file = obj['file']
    if (typeof obj['pattern'] === 'string') entry.pattern = obj['pattern']
    if (typeof obj['rule'] === 'string') entry.rule = obj['rule']
    if (typeof obj['line'] === 'number') entry.line = obj['line']
    if (typeof obj['snippet_hash'] === 'string') {
      entry.snippet_hash = obj['snippet_hash']
    }
    out.push(entry)
  }
  return out
}

export const unquote = (s: string): string => {
  const t = s.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

export const loadAllowlist = (repoRoot: string): AllowlistEntry[] => {
  // Primary source: `.config/socket-wheelhouse.json` → `pathsAllowlist`
  // array. Fleet convention is "JSON not YAML for our own configs"
  // (pnpm-mandated configs stay in pnpm-workspace.yaml; everything
  // else lives in socket-wheelhouse.json). Falls back to the legacy
  // `.github/paths-allowlist.yml` while repos migrate.
  const jsonEntries = loadAllowlistFromJson(repoRoot)
  if (jsonEntries !== undefined) {
    return jsonEntries
  }
  const allowlistPath = path.join(repoRoot, '.github', 'paths-allowlist.yml')
  if (!existsSync(allowlistPath)) {
    return []
  }
  const text = readFileSync(allowlistPath, 'utf8')
  // Tiny YAML parser — only the shape we need: list of entries with
  // `file`, `pattern`, `rule`, `line`, `reason` scalar fields, plus
  // YAML 1.2 block-scalar indicators `|` (literal) and `>` (folded)
  // for multi-line reasons. Avoids a yaml dep for a gate that has to
  // be self-contained.
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> | undefined = undefined
  // When set, subsequent more-indented lines fold into this key as a
  // block scalar (literal '|' keeps newlines, folded '>' joins with
  // spaces).
  let blockKey: string | undefined = undefined
  let blockKind: '|' | '>' | undefined = undefined
  let blockIndent = 0
  let blockLines: string[] = []
  const flushBlock = () => {
    if (current && blockKey) {
      const value =
        blockKind === '>'
          ? blockLines.join(' ').replace(/\s+/g, ' ').trim()
          : blockLines.join('\n').replace(/\n+$/, '')
      ;(current as any)[blockKey] = value
    }
    blockKey = undefined
    blockKind = undefined
    blockLines = []
  }
  const indentOf = (line: string): number => {
    let i = 0
    while (i < line.length && line[i] === ' ') {
      i += 1
    }
    return i
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.replace(/\r$/, '')
    // Block-scalar accumulation takes precedence over normal parsing.
    if (blockKey !== null) {
      if (line.trim() === '') {
        // Preserve blank lines inside a literal block; folded blocks
        // turn them into paragraph breaks (kept as separate joins).
        blockLines.push('')
        continue
      }
      const indent = indentOf(line)
      if (indent >= blockIndent) {
        blockLines.push(line.slice(blockIndent))
        continue
      }
      flushBlock()
      // Fall through and re-process the dedented line as normal.
    }
    if (!line.trim() || line.trim().startsWith('#')) {
      continue
    }
    const tryAssign = (key: string, value: string) => {
      const trimmed = value.trim()
      if (current === null) {
        return
      }
      if (trimmed === '|' || trimmed === '>') {
        blockKey = key
        blockKind = trimmed as '|' | '>'
        blockIndent = indentOf(lines[i + 1] ?? '') || indentOf(line) + 2
        blockLines = []
        return
      }
      ;(current as any)[key] =
        key === 'line' ? Number(unquote(trimmed)) : unquote(trimmed)
    }
    if (line.startsWith('- ')) {
      if (current && current.reason) {
        entries.push(current as AllowlistEntry)
      }
      current = {}
      const rest = line.slice(2).trim()
      if (rest) {
        const m = rest.match(/^([\w-]+):\s*(.*)$/)
        if (m) {
          tryAssign(m[1]!, m[2]!)
        }
      }
    } else if (current) {
      const m = line.match(/^\s+([\w-]+):\s*(.*)$/)
      if (m) {
        tryAssign(m[1]!, m[2]!)
      }
    }
  }
  if (blockKey !== null) {
    flushBlock()
  }
  if (current && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

/**
 * Stable, normalized snippet hash. Whitespace-insensitive so trivial
 * reformatting (indent change, trailing comma, line wrap) doesn't
 * invalidate an allowlist entry, but content-changing edits do. The
 * hash exposes only the first 12 hex chars (~48 bits) which is plenty
 * for collision-resistance within a single repo's finding set and
 * keeps the YAML readable.
 */
export const snippetHash = (snippet: string): string => {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

/**
 * Allowlist matching trades off two failure modes:
 *
 *   - Drift via reformatting (a line shift breaks an entry, the
 *     finding re-surfaces, devs paper over with a new entry).
 *   - Stealth allowlisting (an entry pinned to "anywhere in this file"
 *     silently exempts unrelated future violations).
 *
 * Strategy: exact line match OR `snippet_hash` match (whitespace-
 * normalized SHA-256, first 12 hex). Either is sufficient. Lines stay
 * exact (was ±2; the slack let reformatting silently slide), and
 * `snippet_hash` provides reformatting-tolerant matching that's still
 * tied to the literal text — paste-and-edit cheating would change the
 * hash. If neither `line` nor `snippet_hash` is provided, the entry
 * matches purely by `rule` + `file` + `pattern` (file-level exempt;
 * use sparingly and always pair with a precise `pattern`).
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
