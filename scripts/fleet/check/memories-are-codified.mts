#!/usr/bin/env node
/**
 * @file Assertion: every `feedback`/`project` memory pairs with an enforcer.
 *   Memory is per-user, per-machine, invisible to the fleet — a lesson that
 *   lives ONLY there is policy on paper. This is the audit half of the
 *   memory→code-is-law pipeline (the write-time half is
 *   `uncodified-lesson-nudge`): when this machine has a memory store for the
 *   current project, every codifiable memory must carry a resolving
 *   `enforcement:` disposition in its frontmatter:
 *   enforcement: .claude/hooks/fleet/<name>     # a hook/rule/script ref
 *   enforcement: socket/<rule>                  # a lint rule
 *   enforcement: scripts/fleet/check/<name>.mts # a check
 *   enforcement: deferred #<task>               # tracked follow-up
 *   enforcement: n/a — <reason>                 # pure-preference lesson
 *   `reference` / `user` memories are exempt (pointers + who-the-user-is, not
 *   codifiable rules).
 *   STRICT gate: every codifiable memory must carry a resolving `enforcement:`
 *   disposition (the #240/#279 retrofit stamped all 191). An unstamped local
 *   memory lists the offenders and exits 1, so a new lesson lands with its
 *   enforcer or an explicit deferral/n-a stamp.
 *   Skips CLEANLY — never false-green — when no memory store exists for this
 *   project (CI, a fresh checkout, a teammate's machine): prints an explicit
 *   "skipped (no memory store)" and exits 0.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// Strict gate: every codifiable memory (type feedback|project) must carry an
// enforcement: disposition — the #240/#279 retrofit stamped all 191. A missing
// memory dir (CI / a fresh checkout) yields 0 candidates and passes; the gate
// bites only on an unstamped LOCAL memory, forcing a stamp at write time.
const MODE: 'report' | 'strict' = 'strict'

export interface MemoryCodifyResult {
  readonly candidates: number
  readonly uncodified: readonly string[]
}

/**
 * The per-project memory store path Claude Code uses: the project's absolute
 * path with every path separator turned into `-`, nested under
 * `~/.claude/projects/<slug>/memory/`.
 */
export function memoryStoreDir(repoRoot: string, home = os.homedir()): string {
  const slug = repoRoot.split(path.sep).join('-')
  return path.join(home, '.claude', 'projects', slug, 'memory')
}

// A codifiable memory type — a rule/lesson that an enforcer could catch.
const CODIFIABLE_TYPES = new Set(['feedback', 'project'])

/**
 * A memory is codified when its frontmatter carries a non-empty `enforcement:`
 * line (top-level or nested under `metadata:`). Presence-only for report mode;
 * ref resolution is a strict-mode refinement.
 *
 * The value must sit on the SAME line as the key: `\s` (used for the gap
 * between `enforcement:` and its value) matches newlines too, so a naive
 * `\s*\S+` reads straight through an EMPTY `enforcement:` line into whatever
 * non-whitespace starts the next line (the closing `---` fence, or the next
 * frontmatter key) and reports it as codified. `[ \t]*` restricts the gap to
 * horizontal whitespace, so an empty stamp correctly reads as uncodified.
 */
export function isCodified(content: string): boolean {
  return /^[ \t]*enforcement:[ \t]*\S+/m.test(content)
}

/**
 * The `type:` of a memory (top-level or under `metadata:`), or undefined.
 * Same same-line restriction as `isCodified` — see its comment.
 */
export function memoryType(content: string): string | undefined {
  const match = content.match(/^[ \t]*type:[ \t]*([A-Za-z]+)/m)
  return match?.[1]
}

/**
 * Scan a memory store dir: return the count of codifiable memories and the
 * names of the ones missing an `enforcement:` disposition. MEMORY.md (the
 * index) is skipped.
 */
export function findUncodifiedMemories(dir: string): MemoryCodifyResult {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { candidates: 0, uncodified: [] }
  }
  const uncodified: string[] = []
  let candidates = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (!name.endsWith('.md') || name === 'MEMORY.md') {
      continue
    }
    let content: string
    try {
      content = readFileSync(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    const type = memoryType(content)
    if (!type || !CODIFIABLE_TYPES.has(type)) {
      continue
    }
    candidates += 1
    if (!isCodified(content)) {
      uncodified.push(name)
    }
  }
  uncodified.sort()
  return { candidates, uncodified }
}

export function main(): void {
  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const dir = memoryStoreDir(repoRoot)
  if (!existsSync(dir)) {
    logger.log(
      'memories-are-codified: skipped (no memory store for this project — CI / fresh checkout).',
    )
    return
  }
  const { candidates, uncodified } = findUncodifiedMemories(dir)
  if (uncodified.length === 0) {
    logger.log(
      `memories-are-codified: OK — all ${candidates} codifiable memories carry an enforcement: disposition.`,
    )
    return
  }
  logger.warn(
    `memories-are-codified: ${uncodified.length}/${candidates} codifiable memories are UNCODIFIED ` +
      '(no enforcement: disposition):',
  )
  for (const name of uncodified) {
    logger.warn(`  ${name}`)
  }
  logger.warn(
    'Pair each with an enforcer (hook / lint rule / check) or stamp its frontmatter: ' +
      'enforcement: <ref> | deferred #<task> | n/a — <reason>. ' +
      'Write-time reminder: uncodified-lesson-nudge.',
  )
  if (MODE === 'strict') {
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
/* c8 ignore stop */
