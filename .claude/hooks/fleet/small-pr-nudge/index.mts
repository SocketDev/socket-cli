#!/usr/bin/env node
// Claude Code PreToolUse hook — small-pr-nudge.
//
// Reminder (NOT a block) on `gh pr create` invocations when the PR diff
// is large. Fleet PRs stay small — one logical feature/fix, ~200 changed
// lines. A large PR is decomposed into smaller landed commits, or stacked
// (`gh pr create --base <previous-branch>`).
//
// The fleet DIRECT-PUSHES to main; a PR happens only on push-rejection or
// for external / cross-repo work. So "small PRs" is the same discipline as
// the fleet's small-commit + land-fast cadence — this hook enforces the
// size ceiling on the rare PR path.
//
// Detection of the `gh pr create` invocation and the `--base` flag is
// AST-based (the shell-quote-backed shell-command.mts parser, not regex),
// so `&&` chains, quoting, and `$(…)` are handled correctly.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import {
  defaultBranchOf,
  isGhPrCreate,
} from '../pr-vs-push-default-nudge/index.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

import type { Command } from '../_shared/shell-command.mts'

// Fleet doctrine: one logical feature/fix, ~200 changed lines. A PR whose
// three-dot diff exceeds this is a candidate for decomposition or stacking.
const SMALL_PR_LINES = 200

/**
 * The changed-line + file totals of a PR's three-dot diff against `base`.
 * Undefined when the diff can't be computed (not a git repo, base ref
 * absent, git errored) — the hook fails open in that case.
 */
export interface DiffSize {
  readonly files: number
  readonly lines: number
}

// True when a parsed `gh` segment is a `pr create` / `pr new`. The verb is
// the first two non-flag args after the binary.
function isGhPrCreateCmd(c: Command): boolean {
  const verbs = c.args.filter(a => !a.startsWith('-'))
  return verbs[0] === 'pr' && (verbs[1] === 'create' || verbs[1] === 'new')
}

// Read a flag's value from parsed args, supporting `--base v`, `--base=v`,
// and the short `-B v`. Returns undefined when the flag is absent.
function flagValue(
  args: readonly string[],
  long: string,
  short: string,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === long || a === short) {
      const next = args[i + 1]
      return next && !next.startsWith('-') ? next : undefined
    }
    if (a.startsWith(`${long}=`)) {
      return a.slice(long.length + 1)
    }
  }
  return undefined
}

/**
 * The `--base` / `-B` value of a `gh pr create` command, or undefined when
 * the flag is absent (the PR then targets the repo default branch).
 */
export function prBaseOf(command: string): string | undefined {
  for (const c of commandsFor(command, 'gh')) {
    if (!isGhPrCreateCmd(c)) {
      continue
    }
    const base = flagValue(c.args, '--base', '-B')
    if (base !== undefined) {
      return base
    }
  }
  return undefined
}

/**
 * Parse `git diff --shortstat` output into a {@link DiffSize}. The shortstat
 * line looks like `N files changed, I insertions(+), D deletions(-)`; any of
 * the three clauses may be absent (a pure-insertion diff omits deletions,
 * etc.). Returns undefined for empty / unparseable output.
 */
export function parseShortstat(shortstat: string): DiffSize | undefined {
  const text = shortstat.trim()
  if (!text) {
    return undefined
  }
  const filesMatch = /(\d+)\s+files?\s+changed/.exec(text)
  const insMatch = /(\d+)\s+insertions?\(\+\)/.exec(text)
  const delMatch = /(\d+)\s+deletions?\(-\)/.exec(text)
  if (!filesMatch && !insMatch && !delMatch) {
    return undefined
  }
  const files = filesMatch ? Number(filesMatch[1]) : 0
  const insertions = insMatch ? Number(insMatch[1]) : 0
  const deletions = delMatch ? Number(delMatch[1]) : 0
  return { files, lines: insertions + deletions }
}

/**
 * The size of the PR's three-dot diff (`git diff --shortstat base...HEAD`)
 * run in `cwd`. Three-dot compares HEAD against the merge base with `base`,
 * which is what a PR actually proposes. Returns undefined when the diff
 * can't be computed (git errors, base ref absent) so the hook fails open.
 */
export function prDiffSize(cwd: string, base: string): DiffSize | undefined {
  const r = spawnSync('git', ['diff', '--shortstat', `${base}...HEAD`], {
    cwd,
    timeout: 5000,
  })
  if (r.status !== 0) {
    return undefined
  }
  return parseShortstat(String(r.stdout))
}

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    if (!isGhPrCreate(command)) {
      return undefined
    }
    const cwd = payload.cwd ?? process.cwd()
    // Base = the explicit --base/-B flag, else the repo default branch.
    const base = prBaseOf(command) ?? defaultBranchOf(cwd)
    const size = prDiffSize(cwd, base)
    if (!size || size.lines <= SMALL_PR_LINES) {
      return undefined
    }
    const stackHint = base === 'main' ? '<previous-branch>' : base
    return notify(
      [
        '[small-pr-nudge] This PR is large',
        '',
        `  Diff: ${size.lines} changed lines across ${size.files} file(s) vs ${base} (${base}...HEAD).`,
        `  Fleet PRs stay small — one logical feature/fix, ~${SMALL_PR_LINES} changed lines.`,
        '',
        '  Decompose into smaller landed commits, or stack the change:',
        '',
        `    gh pr create --base ${stackHint}`,
        '',
        '  Per CLAUDE.md small-PR guidance — small reviewable units keep',
        '  review sharp and agents constrained. The fleet realizes this as',
        '  small commits landed fast (direct-push); the size rule bites on',
        '  the rare PR path.',
        '',
        '  Reminder-only; not a block.',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
