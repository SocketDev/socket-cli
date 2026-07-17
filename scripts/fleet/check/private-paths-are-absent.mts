// Fleet check — no INTERNAL / PRIVATE path references in committed source comments.
//
// The commit-time complement to the `no-private-path-in-source-guard` edit-time
// hook and the `socket/no-private-path-in-source` lint rule (three surfaces,
// one rule — code is law). The incident: an agent leaked a scaffolding-repo
// plans-directory path into a public napi-rs source comment, disclosing
// internal fleet layout. The guard blocks NEW writes; this gate fails
// `check --all` if ANY tracked SOURCE file already carries one in a comment.
//
// Detected inside comment syntax (NOT inside strings or real code):
//   - paths under the plans or reports directories — untracked operator notes.
//   - `socket-<repo>/.claude/…`                 — another fleet repo's tree.
//   - `/Users/<name>/…`                          — absolute home path.
//   - `../socket-<repo>/…`                       — sibling fleet-repo path.
//
// Scope: tracked source-code files (.rs/.ts/.mts/.js/.go/.py/.c/.h/…). Markdown,
// docs, JSON/YAML, and the `.claude/` tree are out of scope — they reference
// these paths legitimately. JS/TS comments are parsed via the shared acorn
// walker (so a path in a STRING literal never trips); other languages use a
// lexical line/block-comment scan. The matcher itself is the SAME
// `_shared/private-paths.mts` the hook uses — one pattern set, no drift.
//
// Usage: node scripts/fleet/check/private-paths-are-absent.mts [--quiet]

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, sequential gate.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  splitLines,
  walkComments,
} from '../../../.claude/hooks/fleet/_shared/acorn/index.mts'
import {
  describePrivatePathKind,
  extractLexicalCommentBodies,
  matchPrivatePath,
  scanCommentBodyLines,
} from '../../../.claude/hooks/fleet/_shared/private-paths.mts'
import type { PrivatePathFinding } from '../../../.claude/hooks/fleet/_shared/private-paths.mts'
import { isPurePlaceholder } from '../../../.git-hooks/_shared/personal-path.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Source-code extensions to scan. Lock-step with the hook's SOURCE_FILE_RE
// (markdown / docs / JSON / YAML / .claude excluded — they reference these
// paths legitimately).
const SOURCE_FILE_RE =
  /\.(?:[cm]?[jt]sx?|cc|cpp|cxx|hpp|hh|[ch]|rs|go|py|rb|java|kt|swift|sh|bash|zsh)$/

const JS_TS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/

// A line carrying any of these opt-out markers is exempt: `private-path` (this
// rule), or the fleet's existing same-intent markers `personal-path` (a /Users/
// example) and `cross-repo` (a `../socket-<repo>/` example) — a doc-comment or
// fixture that deliberately SHOWS the pattern it documents.
const SUPPRESS_RE =
  /socket-lint:\s*allow\s+(?:private-path|personal-path|cross-repo)\b/

// Files that legitimately NAME these patterns: the three enforcement surfaces
// (this check, the edit-time hook, the lint rule), the shared matcher, the doc
// home, and their tests. A path-component match covers the cascaded
// `template/base/` copies too.
const SELF_EXEMPT_SUBSTRINGS: readonly string[] = [
  '_shared/private-paths.mts',
  'check-private-paths-are-absent.test.mts',
  'check/private-paths-are-absent.mts',
  'no-private-path-in-source-guard.test.mts',
  'no-private-path-in-source-guard/',
  'no-private-path-in-source.test.mts',
  'no-private-path-in-source/',
  'public-surface-hygiene.md',
]

function isSelfExempt(relFile: string): boolean {
  for (let i = 0, { length } = SELF_EXEMPT_SUBSTRINGS; i < length; i += 1) {
    if (relFile.includes(SELF_EXEMPT_SUBSTRINGS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * True when a finding on `rawLine` is documentation, not a leak — so the check
 * skips it. Two exemptions: a per-line `socket-lint: allow` marker, OR (for the
 * home-path class) a PURE placeholder line per the fleet's canonical
 * `isPurePlaceholder` (a bracketed user token, a `$VAR`, or a CI
 * service-account home) — the same posture the fleet's personal-path scanner
 * already takes.
 */
// Canonical fleet PLACEHOLDER tokens — documentation, never a real leak. A
// comment that uses `socket-foo` (the placeholder sibling repo, sibling of the
// `acme-*` family) or a bespoke single-char / ellipsis home stand-in is SHOWING
// the pattern, not leaking a real path. Matched against the captured path's
// owner segment.
const PLACEHOLDER_MATCH_RE =
  /(?:^|[/.])(?:socket-foo\b|Users\/(?:x|me|\.\.\.)(?:\/|$))/ // socket-lint: allow personal-path -- placeholder-token detector, not a real path.

function findingIsDocumentation(
  rawLine: string,
  kind: PrivatePathFinding['kind'],
  match: string,
): boolean {
  if (SUPPRESS_RE.test(rawLine)) {
    return true
  }
  if (kind === 'home-abs-path' && isPurePlaceholder(rawLine)) {
    return true
  }
  // A captured path built from a canonical placeholder owner is documentation.
  return PLACEHOLDER_MATCH_RE.test(match)
}

export interface PrivatePathHit {
  readonly file: string
  readonly line: number
  readonly kind: PrivatePathFinding['kind']
  readonly match: string
}

// Re-export the shared matcher so the unit test can drive it directly.
export { matchPrivatePath }

/**
 * AST comment walk for JS/TS: a path inside a string literal or real code never
 * reaches the matcher. Honors a per-line `socket-lint: allow` marker.
 */
function scanJsTs(relFile: string, text: string): PrivatePathHit[] {
  const hits: PrivatePathHit[] = []
  const sourceLines = splitLines(text)
  for (const c of walkComments(text, { comments: true })) {
    const bodyLines = splitLines(c.value).map(l => l.replace(/^\s*\*\s?/, ''))
    for (const f of scanCommentBodyLines(bodyLines, c.line)) {
      const raw = sourceLines[f.line - 1] ?? ''
      if (findingIsDocumentation(raw, f.kind, f.match)) {
        continue
      }
      hits.push({
        __proto__: null,
        file: relFile,
        line: f.line,
        kind: f.kind,
        match: f.match,
      } as PrivatePathHit)
    }
  }
  return hits
}

/**
 * Lexical scan for non-JS sources (Rust, Go, Python, C, shell). Defers
 * comment-body extraction (block spans, single-line `/* … *\/`, line comments)
 * to the shared `extractLexicalCommentBodies` — same source of truth as the
 * hook — and checks the RAW source line for a per-line `socket-lint: allow`
 * marker before recording a hit.
 */
function scanLexical(relFile: string, text: string): PrivatePathHit[] {
  const hits: PrivatePathHit[] = []
  const lines = text.split('\n')
  for (const { body, line } of extractLexicalCommentBodies(text)) {
    const hit = matchPrivatePath(body)
    if (!hit) {
      continue
    }
    const raw = lines[line - 1] ?? body
    if (findingIsDocumentation(raw, hit.kind, hit.match)) {
      continue
    }
    hits.push({
      __proto__: null,
      file: relFile,
      line,
      kind: hit.kind,
      match: hit.match,
    } as PrivatePathHit)
  }
  return hits
}

/**
 * Scan one file's text for private paths inside comments, dispatching to the
 * AST walker for JS/TS and the lexical scanner otherwise. Pure — the unit tests
 * drive this directly.
 */
export function scanText(relFile: string, text: string): PrivatePathHit[] {
  return JS_TS_FILE_RE.test(relFile)
    ? scanJsTs(relFile, text)
    : scanLexical(relFile, text)
}

/**
 * Tracked source files under `repoRoot` (via `git ls-files`), filtered to
 * source extensions and excluding the `.claude/` tree.
 */
export function listTrackedSourceFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['ls-files'], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    return []
  }
  const out =
    typeof result.stdout === 'string' ? result.stdout : String(result.stdout)
  return out
    .split('\n')
    .map(f => f.trim())
    .filter(
      f => f.length > 0 && SOURCE_FILE_RE.test(f) && !f.includes('.claude/'),
    )
}

export function scanRepo(repoRoot: string): PrivatePathHit[] {
  const hits: PrivatePathHit[] = []
  const files = listTrackedSourceFiles(repoRoot)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    if (isSelfExempt(rel)) {
      continue
    }
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    hits.push(...scanText(rel, text))
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanRepo(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-private-paths-are-absent] private/internal paths in source comments:',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(
        `  ✗ ${h.file}:${h.line} — ${describePrivatePathKind(h.kind)}: ${h.match}`,
      )
    }
    logger.error(
      '  These leak internal fleet layout, operator-local notes, or a dev-box path into committed source.',
    )
    logger.error(
      '  Remove the path from the comment (describe the constraint, not where a plan doc lives), or append `// socket-lint: allow private-path` on a line that must keep an illustrative example. See docs/agents.md/fleet/public-surface-hygiene.md.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-private-paths-are-absent] no private paths in source comments.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
