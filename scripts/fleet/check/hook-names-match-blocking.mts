// Fleet check — hook name ⟷ blocking-behavior match.
//
// Fleet convention (CLAUDE.md hook naming): a `-guard` hook BLOCKS, a
// `-reminder` hook NUDGES. A `-guard` that never blocks lies about its
// behavior (it's really a reminder); a `-reminder` that blocks is a guard in
// disguise. Either way the name misleads the reader about whether the hook
// will stop their action. This check holds the name to the behavior.
//
// Complements `hooks-have-no-guard-reminder-overlap` (which forbids a `-guard`
// AND `-reminder` for the SAME concern); this one checks each hook's own name
// against what it does.
//
// A hook BLOCKS when its index.mts uses any of the 4 block idioms:
//   1. `process.exitCode = 2`   (the canonical with{Bash,Edit}Guard form)
//   2. `process.exit(2)` / `process.exit(1)`
//   3. `return 2` / `return 1`  (a main() returning a non-zero code the entry
//      guard passes to process.exit)
//   4. a `{ decision: 'block' }` stdout JSON  (Stop / PreToolUse decision)
//
// Detection strips comments + string/template literals FIRST, because the words
// "block"/"decision"/"exit" appear constantly in hook prose and in variable
// names (`const blocks = []`), which a raw grep false-matches. After stripping,
// only real code tokens remain.
//
// ERROR (exit 1): a `-guard` with no block idiom (→ rename to `-reminder`), or a
// `-reminder` with a block idiom (→ rename to `-guard`).
//
// Usage: node scripts/fleet/check/hook-names-match-blocking.mts [--quiet]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface NameBehaviorMismatch {
  name: string
  kind: 'guard-never-blocks' | 'reminder-blocks'
}

/**
 * Drop whole-line comments from `.mts` source: a line whose first non-space
 * char starts a `//` line comment or is a `*` (a JSDoc/banner continuation
 * line). This is deliberately NOT a full lexer — a real tokenizer would have to
 * understand regex literals (which every guard has) and template strings, and
 * getting that subtly wrong is how the first version false-flagged 19 real
 * blockers. The block idioms we look for (`process.exitCode = 2`, etc.) are
 * always real CODE on a non-comment line, so dropping comment-only lines is
 * enough to keep the words "block"/"decision"/"exit" out of prose without
 * touching the code lines that carry the real signal. Trailing `// …` comments
 * on a code line are left in place — harmless, since we match specific code
 * shapes, not the bare words.
 */
export function dropCommentLines(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const t = line.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/**
 * True when hook source (comment-lines dropped) contains any of the 4 block
 * idioms.
 */
export function sourceBlocks(source: string): boolean {
  const code = dropCommentLines(source)
  return (
    /\bprocess\s*\.\s*exitCode\s*=\s*[12]\b/.test(code) ||
    /\bprocess\s*\.\s*exit\s*\(\s*[12]\s*\)/.test(code) ||
    /\breturn\s+[12]\b/.test(code) ||
    // A Stop/PreToolUse block decision: `decision: 'block'` / `"block"` written
    // to stdout. Match the literal key:value on a code line.
    /\bdecision\b\s*:\s*['"]block['"]/.test(code)
  )
}

export function listHookNames(hooksDir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(hooksDir)
  } catch {
    return []
  }
  const names: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === '_shared' || name.startsWith('.')) {
      continue
    }
    try {
      if (statSync(path.join(hooksDir, name)).isDirectory()) {
        names.push(name)
      }
    } catch {}
  }
  return names
}

/**
 * Classify every `-guard` / `-reminder` hook by whether its name matches its
 * blocking behavior. Hooks ending in neither suffix (setup-*, etc.) are skipped.
 */
export function findMismatches(hooksDir: string): NameBehaviorMismatch[] {
  const out: NameBehaviorMismatch[] = []
  const names = listHookNames(hooksDir)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    const isGuard = name.endsWith('-guard')
    const isReminder = name.endsWith('-reminder')
    if (!isGuard && !isReminder) {
      continue
    }
    let source: string
    try {
      source = readFileSync(path.join(hooksDir, name, 'index.mts'), 'utf8')
    } catch {
      continue
    }
    const blocks = sourceBlocks(source)
    if (isGuard && !blocks) {
      out.push({ name, kind: 'guard-never-blocks' })
    } else if (isReminder && blocks) {
      out.push({ name, kind: 'reminder-blocks' })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hooksDir = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')
  const mismatches = findMismatches(hooksDir)

  if (mismatches.length) {
    logger.fail(
      '[check-hook-names-match-blocking] hook name does not match its blocking behavior:',
    )
    for (let i = 0, { length } = mismatches; i < length; i += 1) {
      const m = mismatches[i]!
      if (m.kind === 'guard-never-blocks') {
        logger.error(
          `  ✗ ${m.name} is a \`-guard\` but never blocks (no exitCode=2 / exit(2) / return 2 / decision:'block') — rename to \`-reminder\` (it nudges, it doesn't gate).`,
        )
      } else {
        logger.error(
          `  ✗ ${m.name} is a \`-reminder\` but blocks (sets a non-zero exit / emits a block decision) — rename to \`-guard\` (it gates).`,
        )
      }
    }
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      '[check-hook-names-match-blocking] every -guard blocks and every -reminder nudges.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
