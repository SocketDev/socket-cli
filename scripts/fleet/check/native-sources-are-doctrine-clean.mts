/*
 * @file The shared half of the cross-language lint-parity effort: the fleet
 *   `socket/*` doctrine rules that no native linter can express, enforced once
 *   across Rust / Go / C++ source (`.rs`, `.go`, `.c/.cc/.cpp/.cxx`,
 *   `.h/.hpp/.hh`). One scanner, all languages — DRY, and it can't drift the way
 *   three custom-lint frameworks would. The API-shape ports (no-process-chdir,
 *   no-boolean-trap-param, no-console-prefer-logger) live in the native configs
 *   (clippy.toml / .golangci.yml / .clang-tidy); this file carries the
 *   language-agnostic doctrine:
 *
 *     - no-status-emoji           — no decorative/status emoji in source
 *     - personal-path-placeholders — no hardcoded /Users/<name> or /home/<name>
 *     - max-file-lines            — files stay under MAX_SOURCE_LINES
 *
 *   Scoped to where the doctrine holds (scope-codified-rules):
 *     - String/char-literal contents are exempt from the unicode findings — an
 *       emoji that is the SUBJECT of a grapheme-width test is data, not a
 *       decorative status marker. A line citing a codepoint (`U+XXXX`) is
 *       likewise discussing the character as data.
 *     - Frozen test corpora (corpus/, fixtures/, testdata/, golden/ dirs) are
 *       exempt from the unicode findings — corpus content is upstream-frozen
 *       data the repo must not rewrite.
 *     - The line cap applies to FIRST-PARTY sources only: files under a
 *       lockstep-declared port tree (`local_impl` / `local_area` / `local`
 *       rows) mirror upstream file structure, so the cap must not force a
 *       restructure that breaks diffability against upstream.
 *     - `upstream/`, `vendor/`, `third_party/` trees are wholly skipped; a
 *       dangling symlink, sparse submodule checkouts, is skipped, never a
 *       crash.
 *
 *   Conservative by design: it flags only unambiguous violations so a cascade
 *   never false-reds a member's CI. Fails the gate loud (What / Where /
 *   Saw-vs-wanted / Fix). No-ops when the repo has no such source.
 *   Usage: node scripts/fleet/check/native-sources-are-doctrine-clean.mts
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { loadManifestTree, resolveManifestRoot } from '../lockstep/manifest.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Source files this doctrine applies to. JS/TS is covered by the oxlint plugin.
const SOURCE_EXT = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.go',
  '.h',
  '.hh',
  '.hpp',
  '.rs',
])

// Directories that never hold hand-written fleet source.
const SKIP_DIRS = new Set([
  // Downloaded third-party SDKs land here (e.g. the binaryen release the wasm
  // toolchain setup fetches, whose binaryen-c.h is 3849 lines). Gating a
  // vendored header on fleet doctrine reports a violation nobody can fix
  // without editing someone else's release artifact.
  '.cache',
  '.git',
  'build',
  'dist',
  'node_modules',
  'target', // Rust build output
  'third_party',
  'upstream', // lockstep upstream submodule checkouts
  'vendor', // Go/C++ vendored deps
])

// Frozen test-corpus dir names: their content is generated or upstream-frozen
// data, exempt from the unicode findings (rewriting a corpus to appease a
// style rule would break its fidelity).
const CORPUS_DIRS = new Set([
  'corpora',
  'corpus',
  'fixtures',
  'golden',
  'testdata',
])

// Port of socket/max-file-lines — the fleet's file-length ceiling.
const MAX_SOURCE_LINES = 1000

// Port of socket/no-status-emoji — decorative/status emoji don't belong in
// source. A conservative set of the common offenders (checkmarks, crosses,
// warning, rocket, sparkles, fire, party) rather than the full unicode range.
const STATUS_EMOJI =
  /[✅❌\u{26a0}✨\u{1f680}\u{1f525}\u{1f389}\u{1f44d}\u{1f44e}]/u

// Port of socket/personal-path-placeholders — a machine-specific home path
// leaked into committed source (/Users/<user>/… or /home/<user>/…).
const PERSONAL_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//

// A `U+XXXX` codepoint citation. A line that names a codepoint is DISCUSSING
// the character as data (a width-test comment like `// ⚠ = U+26A0 …`), not
// decorating status — exempt from the emoji finding.
const CODEPOINT_CITATION = /U\+[0-9A-Fa-f]{4,6}/

interface Violation {
  file: string
  line: number
  rule: string
  saw: string
}

export interface ScanOptions {
  // Repo-relative lockstep port roots (local_impl / local_area / local rows).
  // Files under one mirror upstream structure — the line cap does not apply.
  readonly portRoots?: readonly string[] | undefined
}

/**
 * True when `relPath` sits under, or is, one of `roots` — POSIX-normalized
 * prefix match on whole segments.
 */
export function isUnderAny(relPath: string, roots: readonly string[]): boolean {
  const p = normalizePath(relPath)
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = normalizePath(roots[i]!).replace(/\/+$/, '')
    if (p === root || p.startsWith(`${root}/`)) {
      return true
    }
  }
  return false
}

/**
 * True when `relPath` has a frozen-corpus dir segment (CORPUS_DIRS).
 */
export function isCorpusPath(relPath: string): boolean {
  return normalizePath(relPath)
    .split('/')
    .some(seg => CORPUS_DIRS.has(seg))
}

/**
 * Mask string/char-literal CONTENTS on one line so the unicode scans see only
 * code + comments. Handles `"…"`, `'…'`, and `` `…` ``, Go raw, with
 * backslash escapes for the quote forms; an unterminated opener masks to end
 * of line (the conservative side of a multi-line literal: its interior is
 * data). The delimiters themselves survive so the line stays recognizable.
 */
export function maskStringLiterals(line: string): string {
  let out = ''
  let i = 0
  const { length } = line
  while (i < length) {
    const ch = line[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch
      i += 1
      while (i < length) {
        const c = line[i]!
        if (c === '\\' && ch !== '`' && i + 1 < length) {
          out += '..'
          i += 2
          continue
        }
        if (c === ch) {
          out += c
          i += 1
          break
        }
        out += '.'
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * Scan one file's text for doctrine violations. The unicode findings skip
 * string-literal contents and frozen corpus files; the line cap skips
 * lockstep-declared port trees (see the @file scoping notes).
 */
export function scanSource(
  relPath: string,
  text: string,
  options?: ScanOptions | undefined,
): Violation[] {
  const opts = { __proto__: null, ...options } as ScanOptions
  const out: Violation[] = []
  const lines = text.split('\n')
  const inPortTree = isUnderAny(relPath, opts.portRoots ?? [])
  if (lines.length > MAX_SOURCE_LINES && !inPortTree) {
    out.push({
      file: relPath,
      line: lines.length,
      rule: 'max-file-lines',
      saw: `${lines.length} lines (limit ${MAX_SOURCE_LINES})`,
    })
  }
  const corpus = isCorpusPath(relPath)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const masked = corpus ? '' : maskStringLiterals(line)
    if (
      !corpus &&
      STATUS_EMOJI.test(masked) &&
      !CODEPOINT_CITATION.test(line)
    ) {
      out.push({
        file: relPath,
        line: i + 1,
        rule: 'no-status-emoji',
        saw: line.trim(),
      })
    }
    if (PERSONAL_PATH.test(line)) {
      out.push({
        file: relPath,
        line: i + 1,
        rule: 'personal-path-placeholders',
        saw: line.trim(),
      })
    }
  }
  return out
}

/**
 * Repo-relative lockstep port roots: every `local_impl` / `local_area` /
 * `local` path a lockstep row declares. Files under one are ports that mirror
 * upstream file structure — first-party for maintenance, upstream-shaped for
 * layout — so the line cap is scoped off them. Empty when the repo carries no
 * lockstep manifest.
 */
export function lockstepPortRoots(repoRoot: string): string[] {
  const rootManifest = resolveManifestRoot(repoRoot)
  if (!existsSync(rootManifest)) {
    return []
  }
  const { merged } = loadManifestTree(rootManifest)
  const roots = new Set<string>()
  for (let i = 0, { length } = merged.rows; i < length; i += 1) {
    const row = merged.rows[i] as {
      local?: string | undefined
      local_area?: string | undefined
      local_impl?: string | undefined
    }
    for (const p of [row.local, row.local_area, row.local_impl]) {
      if (typeof p === 'string' && p) {
        roots.add(normalizePath(p).replace(/\/+$/, ''))
      }
    }
  }
  return [...roots].toSorted()
}

/**
 * Whether `dir` is the fleet's nested-worktree root (`.claude/worktrees`).
 * Matched as a path SEGMENT PAIR, not a bare basename: `worktrees` alone is a
 * plausible name for a real source directory, so skipping it everywhere would
 * silently shrink the scanned set.
 */
function isNestedWorktreeRoot(dir: string): boolean {
  const unix = normalizePath(dir)
  return unix.endsWith('/.claude/worktrees') || unix === '.claude/worktrees'
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue
    }
    const full = path.join(dir, name)
    // A nested git worktree is a DIFFERENT branch's checkout. Its files are not
    // this checkout's source, so a finding there blames the wrong tree — and its
    // own node_modules holds a pnpm parent-link cycle
    // (`<pkg>/test/node_modules/@scope/<pkg> -> ../../..`) that recurses until
    // scandir throws ENAMETOOLONG.
    if (isNestedWorktreeRoot(full)) {
      continue
    }
    // lstat first: a dangling symlink (sparse submodule checkout, reaped
    // build output) must be SKIPPED, not crash the whole gate on statSync.
    const lst = lstatSync(full)
    let isDir = lst.isDirectory()
    let isFile = lst.isFile()
    if (lst.isSymbolicLink()) {
      try {
        const st = statSync(full)
        isDir = st.isDirectory()
        isFile = st.isFile()
      } catch {
        continue
      }
    }
    if (isDir) {
      walk(full, out)
    } else if (isFile && SOURCE_EXT.has(path.extname(name))) {
      out.push(full)
    }
  }
}

/**
 * Scan `repoRoot`'s Rust/Go/C++ source for the shared doctrine. Returns the
 * intended exit code (0 = clean / no such source, 1 = violations).
 */
export function runCheck(repoRoot: string): number {
  const files: string[] = []
  walk(repoRoot, files)
  const portRoots = lockstepPortRoots(repoRoot)
  const violations = files.flatMap(f =>
    scanSource(path.relative(repoRoot, f), readFileSync(f, 'utf8'), {
      portRoots,
    }),
  )
  if (violations.length === 0) {
    return 0
  }
  logger.fail(
    [
      `[native-sources-are-doctrine-clean] ${violations.length} violation(s).`,
      '',
      ...violations.map(
        v => `  ${v.rule}: ${v.file}:${v.line}\n    Saw: ${v.saw}`,
      ),
      '',
      '  Fix: see .claude/rules/fleet/lint-parity-across-languages.md',
      '',
    ].join('\n'),
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runCheck(REPO_ROOT)
}
