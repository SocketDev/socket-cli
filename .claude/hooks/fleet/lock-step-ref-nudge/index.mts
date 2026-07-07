#!/usr/bin/env node
// Claude Code PreToolUse hook — lock-step-ref-nudge.
//
// renamed-from: lock-step-ref-guard
//
// Flags two failure modes in `Lock-step` comments at the moment they
// land in a file, before they reach CI (which is gated separately by
// `scripts/fleet/check/lock-step-refs-resolve.mts`):
//
//   1. STALE — the comment names a path that no longer exists in the
//      target impl. The CI gate also catches this; the hook catches it
//      one keystroke earlier so the porter can fix as they type.
//   2. MALFORMED — the comment uses an almost-right shape (`lockstep`,
//      `Lock step`, `Lock-step Go:` missing `with`/`from`, missing the
//      `<Lang>: <path>` separator). These wouldn't be matched by the
//      CI scanner at all — they'd silently rot forever. The hook is
//      the only place that catches the typo class.
//
// Convention spec: `docs/agents.md/fleet/parser-comments.md` §5–6.
// Recognized forms:
//
//   //! Lock-step with <Lang>: <path>               (canonical side)
//   //! Lock-step from <Lang>: <path>               (port side)
//   // Lock-step with <Lang>: <path>[:<lineno>]     (inline cross-ref)
//   // Lock-step note: <freeform>                   (rationale; not validated)
//
// Behavior:
//   - Never blocks. Hook is informational; the breadcrumb in stderr is
//     the next-turn nudge. The blocking layer is the CI gate in
//     `pnpm check`.
//   - Opt-in per repo: when `.config/lock-step-refs.json` is absent,
//     STALE checks are skipped (the gate is disabled at the repo
//     level). MALFORMED checks always run — they detect typos
//     regardless of whether the repo has opted into validation.
//   - Only fires for the new content the edit introduces. Comments
//     that were already in the file but unchanged aren't re-flagged.
//
// Scope:
//   - Source-file extensions: .rs, .go, .cpp, .hpp, .h, .ts, .mts,
//     .cts, .tsx, .py, .zig, .js, .mjs, .cjs, .jsx.
//   - Skips test/ directories and *.test.* files — illustrative
//     example refs are common in tests.
//
// Bypass: type `Allow lock-step bypass` in a recent user message.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface LockStepConfig {
  readonly roots: Readonly<Record<string, readonly string[]>>
  readonly scan: readonly string[]
  readonly extensions: readonly string[]
}

const BYPASS_PHRASES = [
  'Allow lock-step bypass',
  'Allow lockstep bypass',
  'Allow lock step bypass',
] as const

const SOURCE_EXT_RE =
  /\.(?:cjs|cpp|cts|go|h|hh|hpp|js|jsx|mjs|mts|py|rs|ts|tsx|zig)$/

// Canonical form: `Lock-step (with|from) <Lang>: <path>[:<lineno>]`.
// Path must contain `.` or `/` so prose like "Lock-step with Go: JSON
// parser" doesn't false-positive.
const CANONICAL_RE =
  /Lock-step (?<form>from|with) (?<lang>[A-Za-z][A-Za-z0-9+#-]*): (?<refPath>[^\s:,]*[./][^\s:,]*)(?::(?:\d+(?:-\d+)?))?/g

// Note form is rationale-only; we accept it but don't validate.
const NOTE_RE = /Lock-step note:/

// Common typos / near-misses we catch as MALFORMED. Each pattern is a
// shape that LOOKS like a lock-step comment but isn't quite right.
//
// 1. Lowercased / unhyphenated: `lockstep`, `lock step`, `Lockstep`.
// 2. Missing `with`/`from`/`note` discriminator: `Lock-step Rust: …`.
// 3. Hyphen-in-Lang gone wrong: `Lock-step with: …` (no lang).
// 4. Comma instead of colon: `Lock-step with Rust, src/foo.rs`.
const MALFORMED_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly hint: string
}> = [
  {
    re: /\blockstep\b/i,
    hint:
      'spell it "Lock-step" with a hyphen — the canonical form ' +
      'matches `grep -r "Lock-step"`',
  },
  {
    re: /\bLock[ _]step\b/,
    hint:
      'use a hyphen — write "Lock-step" not "Lock step" or "Lock_step" ' +
      'so the audit grep is uniform',
  },
  {
    // "Lock-step" followed by an uppercase letter that isn't the start of an
    // allowed discriminator keyword (from, note, with) — catches bare "Lock-step Go:"
    // or similar missing-keyword forms.
    re: /Lock-step (?!(?:from|note|with)\b)[A-Z]/,
    hint:
      'missing discriminator — write "Lock-step with <Lang>:" or ' +
      '"Lock-step from <Lang>:" or "Lock-step note:"',
  },
  {
    re: /Lock-step (?:from|with) :/,
    hint:
      'missing <Lang> token — write "Lock-step with Go: <path>" ' +
      'not "Lock-step with : <path>"',
  },
  {
    re: /Lock-step (?:from|with) [A-Za-z][A-Za-z0-9+#-]*,\s/,
    hint:
      'use ":" between <Lang> and <path>, not "," — ' +
      '"Lock-step with Go: parser.go" not "Lock-step with Go, parser.go"',
  },
]

export function checkStale(
  refs: readonly MatchedRef[],
  config: LockStepConfig,
  repoRoot: string,
): StaleHit[] {
  const hits: StaleHit[] = []
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const ref = refs[i]!
    const roots = config.roots[ref.lang]
    if (!roots || !roots.length) {
      hits.push({
        lineNumber: ref.lineNumber,
        preview: ref.preview,
        reason: 'unknown-lang',
        lang: ref.lang,
        refPath: ref.refPath,
      })
      continue
    }
    let found = false
    if (existsSync(path.join(repoRoot, ref.refPath))) {
      found = true
    } else {
      for (let r = 0, { length: rLen } = roots; r < rLen; r += 1) {
        if (existsSync(path.join(repoRoot, roots[r]!, ref.refPath))) {
          found = true
          break
        }
      }
    }
    if (!found) {
      hits.push({
        lineNumber: ref.lineNumber,
        preview: ref.preview,
        reason: 'path-not-found',
        lang: ref.lang,
        refPath: ref.refPath,
      })
    }
  }
  return hits
}

interface MatchedRef {
  readonly form: 'with' | 'from'
  readonly lang: string
  readonly refPath: string
  readonly lineNumber: number
  readonly preview: string
}

interface MalformedHit {
  readonly lineNumber: number
  readonly preview: string
  readonly hint: string
}

interface StaleHit {
  readonly lineNumber: number
  readonly preview: string
  readonly reason: 'unknown-lang' | 'path-not-found'
  readonly lang: string
  readonly refPath: string
}

export function findCanonicalRefs(content: string): MatchedRef[] {
  const hits: MatchedRef[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    CANONICAL_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CANONICAL_RE.exec(line)) !== null) {
      hits.push({
        form: match.groups!.form as 'with' | 'from',
        lang: match.groups!.lang!,
        refPath: match.groups!.refPath!,
        lineNumber: i + 1,
        preview: line.trim().slice(0, 100),
      })
    }
  }
  return hits
}

export function findMalformed(
  content: string,
  canonical: readonly MatchedRef[],
  noteLines: ReadonlySet<number>,
): MalformedHit[] {
  const canonicalLines = new Set(canonical.map(h => h.lineNumber))
  const hits: MalformedHit[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const lineNumber = i + 1
    // If a line already contains a canonical ref or a Lock-step note,
    // don't also flag it as malformed. Heuristic: a single line can
    // have BOTH a canonical ref and a typo elsewhere, but in practice
    // the typos we catch are alternative spellings on the SAME phrase
    // — flagging both would be noise.
    if (canonicalLines.has(lineNumber) || noteLines.has(lineNumber)) {
      continue
    }
    const line = lines[i]!
    for (let p = 0, { length: pLen } = MALFORMED_PATTERNS; p < pLen; p += 1) {
      const { re, hint } = MALFORMED_PATTERNS[p]!
      if (re.test(line)) {
        hits.push({
          lineNumber,
          preview: line.trim().slice(0, 100),
          hint,
        })
        break
      }
    }
  }
  return hits
}

export function findNoteLines(content: string): Set<number> {
  const out = new Set<number>()
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (NOTE_RE.test(lines[i]!)) {
      out.add(i + 1)
    }
  }
  return out
}

export function loadConfig(repoRoot: string): LockStepConfig | undefined {
  const configFile = path.join(repoRoot, '.config', 'lock-step-refs.json')
  if (!existsSync(configFile)) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(configFile, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'roots' in parsed &&
      'scan' in parsed &&
      'extensions' in parsed
    ) {
      return parsed as LockStepConfig
    }
  } catch {
    // Malformed config — let the CI gate report it; hook stays silent.
  }
  return undefined
}

export const check = editGuard((filePath, content, payload) => {
  if (!SOURCE_EXT_RE.test(filePath)) {
    return undefined
  }
  // Skip tests — illustrative example refs are common.
  if (/(^|\/)test\//.test(filePath) || /\.test\.[a-z]+$/.test(filePath)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return undefined
  }
  if (!content) {
    return undefined
  }
  const refs = findCanonicalRefs(content)
  const noteLines = findNoteLines(content)
  const malformed = findMalformed(content, refs, noteLines)

  const repoRoot = payload.cwd ?? process.cwd()
  const config = loadConfig(repoRoot)
  const stale = config ? checkStale(refs, config, repoRoot) : []

  if (malformed.length === 0 && stale.length === 0) {
    return undefined
  }

  const out: string[] = [`[lock-step-ref-nudge] ${filePath}:`, '']
  if (malformed.length > 0) {
    out.push('  Malformed Lock-step comment(s) — fix the shape:')
    for (let i = 0, { length } = malformed; i < length; i += 1) {
      const h = malformed[i]!
      out.push(`    • line ${h.lineNumber}: "${h.preview}"`)
      out.push(`      → ${h.hint}`)
    }
    out.push('')
  }
  if (stale.length > 0) {
    out.push('  Stale Lock-step reference(s) — fix or remove:')
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const h = stale[i]!
      const tag =
        h.reason === 'unknown-lang'
          ? `unknown <Lang> "${h.lang}" (add to .config/lock-step-refs.json roots)`
          : `path not found: ${h.refPath}`
      out.push(`    • line ${h.lineNumber}: ${tag}`)
      out.push(`      "${h.preview}"`)
    }
    out.push('')
  }
  out.push('  Spec: docs/agents.md/fleet/parser-comments.md §5–6.')
  out.push(
    '  CI gate: scripts/fleet/check/lock-step-refs-resolve.mts (run via `pnpm check`).',
  )
  out.push('  Bypass: "Allow lock-step bypass" in a recent user message.')
  out.push('')
  return notify(out.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
