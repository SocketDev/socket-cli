#!/usr/bin/env node
/**
 * @file Assertion: every repo-relative file path cited in this repo's markdown
 *   docs — `CLAUDE.md`, `README.md`, and `docs/**` `.md` files — exists in the
 *   working tree. A fleet-wide audit (2026-07-28) found dead doc references to
 *   be the single most damaging doc-rot class: a release doc where every named
 *   script was fiction, architecture docs naming phantom test runners and
 *   config paths, a README describing a Go codebase that is Rust. A cited path
 *   nothing verifies rots silently, and a reader — human or agent — acts on
 *   the lie. This check makes a dead doc citation a mechanically-caught
 *   defect.
 *   LOCAL and OFFLINE — no gh, no network, no roster. It audits the CURRENT
 *   repo only, so when cascaded to members each repo checks its own docs on
 *   the normal check tier.
 *   Extraction is deliberately conservative — false positives kill a check
 *   like this. Candidates come from inline code spans and markdown link
 *   targets only, and a candidate counts as a repo path only when it contains
 *   a `/`, starts with a known repo tree or ends with a known code/config
 *   extension, and carries no placeholder/glob/env-var/URL/absolute/`..`
 *   shape (see {@link isRepoPathCandidate}). Trailing punctuation and a
 *   `:LINE` / `:LINE:COL` suffix are stripped before the existence test, and
 *   a path naming an existing DIRECTORY passes. Escape hatches: a doc line
 *   containing `docs-refs-ignore` is skipped entirely, and {@link ALLOWLIST}
 *   holds legitimately-absent example paths.
 *   Scope, deliberately: `.claude/skills` and `.claude/commands` bodies are
 *   OUT of scope for now — doc-references-resolve owns their `node <script>`
 *   refs, and the audit's known broken skill-file citations wait on widening
 *   this scan set after the docs backlog burns down.
 *   Report mode for now (loud warn, exit 0): the fleet carries a known-open
 *   backlog — socket-packageurl-js `docs/release.md`, the socket-sdk-js and
 *   socket-registry architecture docs, socket-cli's build guide, the depsight
 *   READMEs — so a hard gate would false-block every push today. Flip MODE to
 *   'strict' once the fleet burns down to zero dead citations — the
 *   member-ci-fires-on-push rollout pattern.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Report now, strict after the fleet docs burn-down (see @file).
const MODE: 'report' | 'strict' = 'report'

/**
 * Exact normalized paths that are legitimately absent — documented examples,
 * paths a doc names on purpose about another state of the tree. Prefer the
 * per-line `docs-refs-ignore` marker for one-off cases; an entry here is a
 * repo-wide exemption and should carry a comment saying why.
 */
export const ALLOWLIST: readonly string[] = []

// A candidate starting with one of these trees is repo-path-shaped even
// without a recognizable extension (e.g. a cited directory).
const KNOWN_PREFIXES: readonly string[] = [
  '.claude/',
  '.config/',
  '.github/',
  'crates/',
  'docs/',
  'packages/',
  'scripts/',
  'src/',
  'template/',
  'test/',
]

// A candidate ending with one of these is repo-path-shaped even outside the
// known trees (e.g. `lib/utils.mts`, `vitest.config.mts` under a subdir).
const KNOWN_EXTENSIONS: readonly string[] = [
  '.cjs',
  '.js',
  '.json',
  '.lock',
  '.md',
  '.mjs',
  '.mts',
  '.py',
  '.rs',
  '.sh',
  '.toml',
  '.ts',
  '.yaml',
  '.yml',
]

// Shapes that mark a candidate as NOT a literal repo path: placeholders
// (`<name>`), globs (`*`), brace sets (`{a,b}`), env vars (`$VAR`), shell
// substitution (`(`), or embedded whitespace.
const EXCLUDED_CHARS_RE = /[<>*{}$( ]/

// A doc line carrying this marker is exempt end-to-end (the escape hatch for
// prose that must cite a nonexistent path, e.g. a rename plan).
const IGNORE_MARKER = 'docs-refs-ignore'

// Inline code span (single-backtick, single-line) and markdown link target.
const INLINE_CODE_RE = /`([^`\n]+)`/g
const LINK_TARGET_RE = /\]\(([^()\s]+)[^()]*\)/g

// Trailing prose punctuation to shave off a candidate before testing it.
const TRAILING_PUNCT_RE = /[:,.;!?)\]'"]+$/
// A `path:LINE` / `path:LINE:COL` citation suffix.
const LINE_SUFFIX_RE = /(?::\d+){1,2}$/

/**
 * Shave citation decoration off a raw candidate: trailing prose punctuation
 * first, then a `:LINE` / `:LINE:COL` suffix. Pure; exported for tests.
 */
export function normalizeCandidate(raw: string): string {
  return raw.trim().replace(TRAILING_PUNCT_RE, '').replace(LINE_SUFFIX_RE, '')
}

/**
 * True when a NORMALIZED candidate is a literal repo-relative path this check
 * stands behind: has a `/`; no placeholder/glob/env/space shape; not
 * absolute, not `~`, not a URL, not a git remote; no `..` segment; not a BARE
 * tree name (`src/` in prose is a convention mention, not a citation of this
 * repo's tree); no dot-tree other than `.github`/`.claude`/`.config`
 * (`.git/index.lock` is runtime state, never in the tree); and either rooted
 * in a known repo tree or ending in a known code/config extension. Pure;
 * exported for tests.
 */
export function isRepoPathCandidate(candidate: string): boolean {
  if (!candidate.includes('/')) {
    return false
  }
  if (EXCLUDED_CHARS_RE.test(candidate)) {
    return false
  }
  if (
    candidate.startsWith('/') ||
    candidate.startsWith('~') ||
    candidate.startsWith('http') ||
    candidate.startsWith('git@')
  ) {
    return false
  }
  if (KNOWN_PREFIXES.includes(candidate)) {
    return false
  }
  if (
    candidate.startsWith('.') &&
    !candidate.startsWith('.github/') &&
    !candidate.startsWith('.claude/') &&
    !candidate.startsWith('.config/')
  ) {
    return false
  }
  const segments = candidate.split('/')
  for (let i = 0, { length } = segments; i < length; i += 1) {
    if (segments[i] === '..') {
      return false
    }
  }
  for (let i = 0, { length } = KNOWN_PREFIXES; i < length; i += 1) {
    if (candidate.startsWith(KNOWN_PREFIXES[i]!)) {
      return true
    }
  }
  for (let i = 0, { length } = KNOWN_EXTENSIONS; i < length; i += 1) {
    if (candidate.endsWith(KNOWN_EXTENSIONS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Every citation candidate in a markdown body: inline code spans and link
 * targets (fragment stripped), from every line NOT carrying the
 * `docs-refs-ignore` marker. Raw strings — classification and normalization
 * happen in {@link classifyCandidates}. Pure; exported for tests.
 */
export function extractCandidates(markdownText: string): string[] {
  const out: string[] = []
  const lines = markdownText.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.includes(IGNORE_MARKER)) {
      continue
    }
    INLINE_CODE_RE.lastIndex = 0
    let m = INLINE_CODE_RE.exec(line)
    while (m !== null) {
      out.push(m[1]!)
      m = INLINE_CODE_RE.exec(line)
    }
    LINK_TARGET_RE.lastIndex = 0
    m = LINK_TARGET_RE.exec(line)
    while (m !== null) {
      const target = m[1]!.replace(/#.*$/, '')
      if (target !== '') {
        out.push(target)
      }
      m = LINK_TARGET_RE.exec(line)
    }
  }
  return out
}

/**
 * One dead reference: the candidate as it appeared in the doc and the
 * normalized repo-relative path that failed the existence test.
 */
export interface DocRefFinding {
  readonly raw: string
  readonly path: string
}

/**
 * The dead references among a candidate list: normalize each, keep only
 * repo-path-shaped ones, drop allowlisted paths, and report the ones the
 * injected existence predicate rejects (the real predicate is `existsSync`
 * under the repo root, so an existing directory passes too). Deduplicated by
 * normalized path. Pure — the predicate is injected so tests never touch the
 * filesystem; exported for tests.
 */
export function classifyCandidates(
  candidates: readonly string[],
  existsFn: (relPath: string) => boolean,
  allowlist: readonly string[] = ALLOWLIST,
): DocRefFinding[] {
  const out: DocRefFinding[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const raw = candidates[i]!
    const rel = normalizeCandidate(raw)
    if (!isRepoPathCandidate(rel)) {
      continue
    }
    if (seen.has(rel)) {
      continue
    }
    seen.add(rel)
    if (allowlist.includes(rel)) {
      continue
    }
    if (existsFn(rel)) {
      continue
    }
    out.push({ raw, path: rel })
  }
  return out
}

// Recursively collect `.md` files, skipping node_modules and dot-entries
// (the scan set's only dot-trees are the two root files handled separately).
function walkMarkdown(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    const abs = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkMarkdown(abs, out)
    } else if (name.endsWith('.md')) {
      out.push(abs)
    }
  }
}

/**
 * The absolute paths of the docs in scope: root `CLAUDE.md` and `README.md`
 * when present, plus every `.md` under `docs/`. Exported for tests.
 */
export function collectDocPaths(repoRoot: string): string[] {
  const out: string[] = []
  const roots = ['CLAUDE.md', 'README.md']
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const abs = path.join(repoRoot, roots[i]!)
    if (existsSync(abs)) {
      out.push(abs)
    }
  }
  walkMarkdown(path.join(repoRoot, 'docs'), out)
  return out
}

export function main(): void {
  const existsFn = (rel: string): boolean =>
    existsSync(path.join(REPO_ROOT, rel))
  const docs = collectDocPaths(REPO_ROOT)
  const all: Array<{ doc: string; finding: DocRefFinding }> = []
  for (let i = 0, { length } = docs; i < length; i += 1) {
    const abs = docs[i]!
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const findings = classifyCandidates(extractCandidates(text), existsFn)
    const relDoc = path.relative(REPO_ROOT, abs)
    for (let j = 0, { length: jLen } = findings; j < jLen; j += 1) {
      all.push({ doc: relDoc, finding: findings[j]! })
    }
  }
  if (all.length === 0) {
    logger.log(
      'docs-file-references-resolve: OK — every repo path cited in CLAUDE.md/README.md/docs resolves in the working tree.',
    )
    return
  }
  logger.warn(
    `docs-file-references-resolve: ${all.length} dead doc reference(s) — a doc citing a path that does not exist lies to every reader who acts on it. Fix the citation, delete the stale prose, mark the line docs-refs-ignore, or allowlist a deliberate example.`,
  )
  for (let i = 0, { length } = all; i < length; i += 1) {
    const f = all[i]!
    logger.warn(
      `  ${f.doc}: \`${f.finding.raw}\` → ${f.finding.path} (not found)`,
    )
  }
  if (MODE === 'strict') {
    process.exitCode = 1
  } else {
    logger.warn(
      '  report mode (exit 0) — MODE flips to strict after the fleet docs burn-down; see the @file docblock.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every repo-relative file path cited in markdown docs exists',
  help: 'Usage: node scripts/fleet/check/docs-file-references-resolve.mts',
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
