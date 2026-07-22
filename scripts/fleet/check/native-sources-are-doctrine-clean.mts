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
 *   Conservative by design: it flags only unambiguous violations so a cascade
 *   never false-reds a member's CI. Fails the gate loud (What / Where /
 *   Saw-vs-wanted / Fix). No-ops when the repo has no such source.
 *   Usage: node scripts/fleet/check/native-sources-are-doctrine-clean.mts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

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
  '.git',
  'build',
  'dist',
  'node_modules',
  'target', // Rust build output
  'third_party',
  'vendor', // Go/C++ vendored deps
])

// Port of socket/max-file-lines — the fleet's file-length ceiling.
const MAX_SOURCE_LINES = 1000

// Port of socket/no-status-emoji — decorative/status emoji don't belong in
// source. A conservative set of the common offenders (checkmarks, crosses,
// warning, rocket, sparkles, fire, party) rather than the full unicode range.
const STATUS_EMOJI = /[✅❌⚠️✨\u{1f680}\u{1f525}\u{1f389}\u{1f44d}\u{1f44e}]/u

// Port of socket/personal-path-placeholders — a machine-specific home path
// leaked into committed source (/Users/<name>/… or /home/<name>/…).
const PERSONAL_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//

interface Violation {
  file: string
  line: number
  rule: string
  saw: string
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue
    }
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (SOURCE_EXT.has(path.extname(name))) {
      out.push(full)
    }
  }
}

/**
 * Scan one file's text for doctrine violations.
 */
export function scanSource(relPath: string, text: string): Violation[] {
  const out: Violation[] = []
  const lines = text.split('\n')
  if (lines.length > MAX_SOURCE_LINES) {
    out.push({
      file: relPath,
      line: lines.length,
      rule: 'max-file-lines',
      saw: `${lines.length} lines (limit ${MAX_SOURCE_LINES})`,
    })
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (STATUS_EMOJI.test(line)) {
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
 * Scan `repoRoot`'s Rust/Go/C++ source for the shared doctrine. Returns the
 * intended exit code (0 = clean / no such source, 1 = violations).
 */
export function runCheck(repoRoot: string): number {
  const files: string[] = []
  walk(repoRoot, files)
  const violations = files.flatMap(f =>
    scanSource(path.relative(repoRoot, f), readFileSync(f, 'utf8')),
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
