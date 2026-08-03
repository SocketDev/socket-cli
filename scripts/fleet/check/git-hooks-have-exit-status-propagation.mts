#!/usr/bin/env node
/**
 * @file Enforce exit-status propagation across the whole `.git-hooks/` shell
 *   corpus — dispatchers, `fleet/`, `repo/`, and the sourced `_shared/*.sh`
 *   fragments. A shell hook that runs a fallible command and drops its non-zero
 *   status is a gate that only PRINTS: the check refuses, the shell discards
 *   the refusal, and the operation proceeds. That is not hypothetical — the
 *   fleet pre-commit ran the Socket security step as a bare `node
 *   …/pre-commit.mts` with no `|| exit $?`, so every refusal that file owns
 *   (API keys, secrets, .DS_Store, private paths, cross-repo refs, soak-bypass
 *   dates, catastrophic mass deletion) printed its verdict and was ignored in
 *   every cascaded repo. Reviewing the logic never finds this class — only
 *   checking the boundary between the logic and its consequence does. This is
 *   that boundary check. A fallible invocation is accepted when it propagates
 *   by any of the legitimate shell means: a file-level `set -e`, `|| exit $?` /
 *   `|| exit N`, `|| return $?` / `|| return N` in a sourced fragment, `||
 *   var=$?` paired with a later `exit "$var"`, a following `var=$?` capture,
 *   use as an `if`/`while`/`until` condition, an `exec` (the hook process IS
 *   the command), or an explicit `|| true` carrying a reason comment. The
 *   matcher is deliberately NARROW: only a curated set of fallible commands and
 *   path invocations are candidates. `echo`, `printf`, comments, variable
 *   assignments, `.` sourcing, and clean-up calls (`rm`, `kill`, `wait`, `cat`)
 *   are never findings. A noisy check gets disabled and then protects nothing,
 *   so a missed exotic form is preferred over a false one. Usage: node
 *   scripts/fleet/check/git-hooks-have-exit-status-propagation.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export const GIT_HOOKS_DIR = '.git-hooks'

/**
 * Commands whose non-zero status must reach the shell. Curated rather than
 * inferred: every entry either runs a fleet gate (`node`, `pnpm`, the
 * `run_step*` wrappers) or reports state the hook branches on (`git`). Any
 * command absent from this list is treated as fire-and-forget. Sorted
 * (socket/sort).
 */
export const FALLIBLE_COMMANDS: readonly string[] = [
  'bash',
  'git',
  'node',
  'npm',
  'npx',
  'pnpm',
  'run_pkg_step_bounded',
  'run_step',
  'run_step_bounded',
  'sh',
  'yarn',
]

/**
 * A finding: one line that runs a fallible command and drops its status.
 */
export interface DroppedExitStatus {
  command: string
  line: number
  text: string
}

/**
 * Strip one layer of surrounding or leading shell quoting from a token.
 */
function unquoteToken(token: string): string {
  return token.replace(/^["']/, '').replace(/["']$/, '')
}

/**
 * A token that invokes a program by path — `"$DIR/fleet/pre-commit"`,
 * `./script.sh`, `/usr/local/bin/thing`. Requires a separator so a bare
 * `$var` expansion is never mistaken for an invocation.
 */
export function isPathInvocation(token: string): boolean {
  const bare = unquoteToken(token)
  if (!bare.includes('/')) {
    return false
  }
  // `$(` command substitution, `$VAR` / `${VAR}` expansion, `./` relative,
  // `/` absolute — the four ways a hook names a program by path.
  return /^(?:\$\(|\$\{?[A-Za-z_]|\.\/|\/)/.test(bare)
}

/**
 * A line that only assigns a variable — `VAR=value`, `VAR=$(cmd)`.
 */
function isAssignmentLine(line: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)
}

/**
 * The file opts into `set -e` (any flag cluster containing `e`, so `set -eu`
 * and `set -euo pipefail` count) as a top-level statement.
 */
export function hasErrExit(hookText: string): boolean {
  return /^[ \t]*set[ \t]+-[a-zA-Z]*e[a-zA-Z]*\b/m.test(hookText)
}

/**
 * Join backslash-continued lines so a multi-line invocation is evaluated as
 * the single command it is. Each joined entry keeps the line number of its
 * FIRST physical line, which is what the operator has to edit.
 */
export function joinContinuations(
  hookText: string,
): Array<{ line: number; text: string }> {
  const physical = hookText.split('\n')
  const joined: Array<{ line: number; text: string }> = []
  let pending = ''
  let pendingAt = 0
  for (let i = 0, { length } = physical; i < length; i += 1) {
    const raw = physical[i]!
    if (!pending) {
      pendingAt = i + 1
    }
    if (raw.trimEnd().endsWith('\\')) {
      pending += `${raw.trimEnd().slice(0, -1)} `
      continue
    }
    const merged = `${pending}${raw}`.trim()
    // Collapse the run of whitespace a fold leaves behind so the reported
    // text reads like the single command it is.
    joined.push({
      line: pendingAt,
      text: pending ? merged.replace(/\s+/g, ' ') : merged,
    })
    pending = ''
  }
  if (pending) {
    joined.push({ line: pendingAt, text: pending.trim().replace(/\s+/g, ' ') })
  }
  return joined
}

/**
 * The command token a line invokes, or undefined when it invokes nothing.
 * A line opening with a shell keyword (`if`, `while`, `until`) is not an
 * invocation, which is exactly why a conditional use of a fallible command is
 * accepted: the branch consumes the status instead of discarding it.
 */
export function fallibleCommandOf(text: string): string | undefined {
  if (!text || text.startsWith('#') || isAssignmentLine(text)) {
    return undefined
  }
  const first = text.split(/\s+/)[0] ?? ''
  if (FALLIBLE_COMMANDS.includes(first) || isPathInvocation(first)) {
    return unquoteToken(first)
  }
  return undefined
}

/**
 * `|| exit $?`, `|| exit 1`, `|| return $?`, `|| return 1`.
 */
function hasExplicitExit(text: string): boolean {
  return /\|\|\s*(?:exit|return)\s+(?:\$\?|\d+)/.test(text)
}

/**
 * `|| status=$?` — safe only when the file later exits with that variable.
 */
function capturesStatusThenExits(text: string, hookText: string): boolean {
  const match = /\|\|\s*([A-Za-z_][A-Za-z0-9_]*)=\$\?/.exec(text)
  if (!match) {
    return false
  }
  const name = match[1]!
  return new RegExp(`\\b(?:exit|return)\\s+"?\\$\\{?${name}\\}?"?`, 'm').test(
    hookText,
  )
}

/**
 * `cmd || true` / `cmd || :` on a line directly under a reason comment. The
 * comment has to be attached — a blank line or a shebang above means the
 * ignore is undocumented, which is the state this gate refuses.
 */
function isDocumentedIgnore(
  text: string,
  entries: ReadonlyArray<{ line: number; text: string }>,
  index: number,
): boolean {
  if (!/\|\|\s*(?::|true)\s*$/.test(text) || index === 0) {
    return false
  }
  const prior = entries[index - 1]!.text
  return !prior.startsWith('#!') && prior.startsWith('#') && prior.length > 2
}

/**
 * The next line captures the status into a variable (comments skipped).
 */
function nextLineCapturesStatus(
  entries: ReadonlyArray<{ line: number; text: string }>,
  index: number,
): boolean {
  for (let i = index + 1, { length } = entries; i < length; i += 1) {
    const next = entries[i]!.text
    if (next.startsWith('#')) {
      continue
    }
    return /^[A-Za-z_][A-Za-z0-9_]*=\$\?$/.test(next)
  }
  return false
}

/**
 * Every fallible invocation in `hookText` whose non-zero status is discarded.
 * Returns [] when the file opts into `set -e` — that propagates every bare
 * statement, which is the whole point of the option.
 */
export function findDroppedExitStatuses(hookText: string): DroppedExitStatus[] {
  if (hasErrExit(hookText)) {
    return []
  }
  const findings: DroppedExitStatus[] = []
  const entries = joinContinuations(hookText)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const { text } = entry
    if (text.startsWith('#!')) {
      continue
    }
    const command = fallibleCommandOf(text)
    if (!command) {
      continue
    }
    if (
      text.startsWith('exec ') ||
      hasExplicitExit(text) ||
      capturesStatusThenExits(text, hookText) ||
      isDocumentedIgnore(text, entries, i) ||
      nextLineCapturesStatus(entries, i)
    ) {
      continue
    }
    findings.push({ command, line: entry.line, text })
  }
  return findings
}

/**
 * A shell script: a `.sh` fragment, or an extensionless file with a shebang.
 */
export function isShellHookFile(filePath: string): boolean {
  if (filePath.endsWith('.sh')) {
    return true
  }
  if (path.extname(filePath) !== '') {
    return false
  }
  const head = readFileSync(filePath, 'utf8').slice(0, 64)
  return /^#!.*\b(?:ba)?sh\b/.test(head)
}

/**
 * Every shell file under `.git-hooks/`, sorted for a stable report.
 */
export function collectShellHookFiles(hooksDir: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    const names = readdirSync(dir).toSorted()
    for (let i = 0, { length } = names; i < length; i += 1) {
      const full = path.join(dir, names[i]!)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (isShellHookFile(full)) {
        found.push(full)
      }
    }
  }
  walk(hooksDir)
  return found
}

function formatFinding(file: string, finding: DroppedExitStatus): string {
  return (
    `Dropped exit status from \`${finding.command}\`.\n` +
    `  Where: ${file}:${finding.line} — ${finding.text}\n` +
    `  Saw: the command runs bare, so a non-zero status is discarded and the ` +
    `hook continues; wanted: the status reaches the shell so a refusal ` +
    `actually blocks.\n` +
    `  Fix: append \` || exit $?\` to that line, or add \`set -e\` below the ` +
    `shebang if every statement in ${path.basename(file)} should propagate.`
  )
}

/**
 * What a scan of one hooks dir found. `scanned` is the resolved file count.
 */
export interface HookScanResult {
  errors: string[]
  hooksDirExists: boolean
  scanned: number
}

/**
 * Scan `hooksDir` and return its findings. Split from `main()` so the scope
 * outcomes — a missing dir, a resolved-zero scope, a real finding — are
 * testable against a fixture tree instead of the repo's own hooks.
 */
export function scanHookDir(hooksDir: string): HookScanResult {
  if (!existsSync(hooksDir)) {
    return { errors: [], hooksDirExists: false, scanned: 0 }
  }
  const files = collectShellHookFiles(hooksDir)
  if (files.length === 0) {
    return {
      errors: [
        `Resolved zero shell hook files.\n` +
          `  Where: ${hooksDir}/.\n` +
          `  Saw: the directory exists but holds no \`.sh\` fragment and no ` +
          `extensionless file with a shell shebang; wanted: at least the ` +
          `dispatchers this gate is meant to cover.\n` +
          `  Fix: the scope resolver is broken or the hooks were removed — ` +
          `restore ${hooksDir}/ from the cascade rather than letting an ` +
          `empty scope report a pass.`,
      ],
      hooksDirExists: true,
      scanned: 0,
    }
  }
  const errors: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const findings = findDroppedExitStatuses(readFileSync(file, 'utf8'))
    for (let j = 0, jlen = findings.length; j < jlen; j += 1) {
      errors.push(formatFinding(file, findings[j]!))
    }
  }
  return { errors, hooksDirExists: true, scanned: files.length }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const result = scanHookDir(GIT_HOOKS_DIR)

  if (!result.hooksDirExists) {
    // Not every repo carries the fleet hook chain; nothing to scan here.
    if (!quiet) {
      logger.log(
        `[git-hooks-have-exit-status-propagation] no ${GIT_HOOKS_DIR}/ — skipping ` +
          `(no hooks scanned; this is NOT a pass).`,
      )
    }
    return
  }

  const { errors } = result
  if (errors.length > 0) {
    logger.fail('[git-hooks-have-exit-status-propagation]')
    for (let i = 0, { length } = errors; i < length; i += 1) {
      if (i > 0) {
        logger.error('')
      }
      logger.error(errors[i]!)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[git-hooks-have-exit-status-propagation] ${result.scanned} shell hook file(s) ` +
        `propagate every fallible status.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
