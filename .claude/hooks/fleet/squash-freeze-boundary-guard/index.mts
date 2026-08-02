#!/usr/bin/env node
// Claude Code PreToolUse hook — squash-freeze-boundary-guard.
//
// Blocks a MANUAL full-root history flatten in a repo that has a frozen
// release boundary — the same hazard `squashing-history`'s runtime
// freeze-boundary resolution (`resolveFreezeBoundaryForRepo`) exists to
// prevent, caught here BEFORE a hand-rolled command ever reaches git. Three
// shapes, all of them mint (or land on) a NEW root with no ancestor:
//
//   1. `git reset --soft <ref>` where `<ref>` resolves to the repo's ROOT
//      commit — the first half of a hand-rolled full-root squash.
//   2. `git rebase --root` (any form) — rebases the whole branch onto a new
//      root, discarding every parent link below it.
//   3. `git commit-tree <tree>` with NO `-p <parent>` — mints a PARENTLESS
//      commit, the exact shape `mintSquashRoot()` uses, run by hand instead
//      of through the runner.
//
// Gated on a CHEAP, LOCAL, no-network signal: the repo is opted into
// `squash-history` AND its root manifest (package.json / Cargo.toml) reports
// a REAL (non-`0.0.0`) version. This is a best-effort heuristic, not the
// authoritative check — `resolveFreezeBoundaryForRepo` (registry reads +
// ancestor-verification) is what the sanctioned runner uses, and it stays
// the actual safety mechanism regardless of this guard's precision. A false
// positive here just means running the sanctioned script instead of the raw
// command; a false negative leaves the runner's own runtime check as the
// backstop.
//
// Fails open on parse / payload errors, outside a fleet repo, on a repo
// still at the placeholder version, and on a repo not opted into
// `squash-history` at all — this guard's whole job is the frozen-zone case.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { gitOut } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { splitGitSubcommand } from '../_shared/git-subcommand.mts'
import {
  isOptedIn,
  loadRosterFromRepo,
  resolveRepoName,
} from '../_shared/fleet-roster.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

export const triggers: readonly string[] = ['reset', 'rebase', 'commit-tree']

// The reserved pre-release version — same constant as
// `scripts/fleet/lib/squash-publish-guard.mts`, duplicated here (not
// imported) so this fast PreToolUse hook never pulls in the wider
// squash-publish-guard/registry import graph.
const PLACEHOLDER_VERSION = '0.0.0'

export type FreezeBoundaryFlattenKind =
  | 'commit-tree-no-parent'
  | 'rebase-root'
  | 'reset-soft-root'

export interface FreezeBoundaryFlattenMatch {
  readonly invocation: string
  readonly kind: FreezeBoundaryFlattenKind
}

/**
 * True when `args` (a git segment's args, after the subcommand) carry a `-p`
 * / `--parent` flag — the presence of ANY parent makes `commit-tree` an
 * ordinary (non-root) commit mint, out of scope for this guard.
 */
export function hasParentFlag(args: readonly string[]): boolean {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === '--parent' || a === '-p') {
      return true
    }
    if (a.startsWith('--parent=')) {
      return true
    }
  }
  return false
}

/**
 * Find a full-root flatten shape in a shell command line, tokenized via the
 * shared parser so chains, substitution, and quoting are handled. Does NOT
 * resolve the "root commit" ref check itself — `matchFreezeBoundaryFlatten`
 * does that once it knows which repo the command targets.
 */
function findFlattenShape(command: string):
  | {
      args: readonly string[]
      rest: readonly string[]
      kind: FreezeBoundaryFlattenKind
    }
  | undefined {
  let parsed
  try {
    parsed = parseCommands(command)
  } catch {
    return undefined
  }
  for (const cmd of parsed) {
    const { args, binary } = cmd
    /* c8 ignore next - defensive: split always yields at least one segment */
    const name = binary.split('/').pop() ?? ''
    if (name !== 'git') {
      continue
    }
    // `rest` is the subcommand's OWN args — the subcommand verb (and any
    // leading git global option) is stripped, so a flag/positional scan below
    // never mistakes 'reset'/'commit-tree' itself for a ref or a value.
    const { rest, sub } = splitGitSubcommand(args)
    if (sub === 'rebase' && rest.includes('--root')) {
      return { args, rest, kind: 'rebase-root' }
    }
    if (sub === 'commit-tree' && !hasParentFlag(rest)) {
      return { args, rest, kind: 'commit-tree-no-parent' }
    }
    if (sub === 'reset' && rest.includes('--soft')) {
      return { args, rest, kind: 'reset-soft-root' }
    }
  }
  return undefined
}

// The positional (non-flag) ref argument of a `reset --soft <ref>` — the
// commit the branch would land on. `args` here is the subcommand's OWN args
// (post-split), so a bare non-flag token is unambiguously the ref.
function resetTargetRef(args: readonly string[]): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a.startsWith('-')) {
      continue
    }
    return a
  }
  return undefined
}

/**
 * Resolve whether `repoDir` has a frozen zone — the cheap, local, no-network
 * heuristic this guard gates on: opted into `squash-history` AND a root
 * manifest reports a real (non-placeholder) version.
 */
export function repoHasLikelyFrozenZone(repoDir: string): boolean {
  const roster = loadRosterFromRepo(repoDir)
  if (!roster) {
    return false
  }
  const repoName = resolveRepoName(repoDir)
  if (!repoName || !isOptedIn(roster, repoName, 'squash-history')) {
    return false
  }
  const pkgPath = path.join(repoDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: unknown | undefined
      }
      if (
        typeof pkg.version === 'string' &&
        pkg.version !== '' &&
        pkg.version !== PLACEHOLDER_VERSION
      ) {
        return true
      }
    } catch {}
  }
  const cargoPath = path.join(repoDir, 'Cargo.toml')
  if (existsSync(cargoPath)) {
    try {
      const text = readFileSync(cargoPath, 'utf8')
      const m = /^\s*version\s*=\s*"([^"]*)"/m.exec(text)
      if (m?.[1] && m[1] !== PLACEHOLDER_VERSION) {
        return true
      }
    } catch {}
  }
  return false
}

/**
 * Full detection: a flatten shape, resolved against the command's target
 * repo, gated on that repo having a likely frozen zone. `reset --soft <ref>`
 * additionally requires `<ref>` to resolve to the repo's ROOT commit — an
 * ordinary `reset --soft HEAD~3` (or any non-root target) is everyday history
 * hygiene, not a full-root flatten.
 */
export function matchFreezeBoundaryFlatten(
  command: string,
  hookCwd?: string | undefined,
): FreezeBoundaryFlattenMatch | undefined {
  const shape = findFlattenShape(command)
  if (!shape) {
    return undefined
  }
  const repoDir = extractGitCwd(command, { cwd: hookCwd })
  if (!repoHasLikelyFrozenZone(repoDir)) {
    return undefined
  }
  if (shape.kind === 'reset-soft-root') {
    const target = resetTargetRef(shape.rest)
    if (!target) {
      return undefined
    }
    const targetSha = gitOut(repoDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      target,
    ])
    if (!targetSha) {
      return undefined
    }
    const root = gitOut(repoDir, ['rev-list', '--max-parents=0', 'HEAD'])
      ?.split('\n')
      .pop()
    if (!root || targetSha !== root) {
      return undefined
    }
  }
  return {
    invocation: ['git', ...shape.args].join(' '),
    kind: shape.kind,
  }
}

const WHAT: Record<FreezeBoundaryFlattenKind, string> = {
  __proto__: null,
  'commit-tree-no-parent':
    '`git commit-tree` with no `-p <parent>` mints a PARENTLESS commit — a new root.',
  'rebase-root':
    '`git rebase --root` rebases the whole branch onto a NEW root, dropping every commit below it.',
  'reset-soft-root':
    "`git reset --soft` targets the repo's ROOT commit — the setup half of a hand-rolled full-root squash.",
} as Record<FreezeBoundaryFlattenKind, string>

export function formatBlock(match: FreezeBoundaryFlattenMatch): string {
  const lines = [
    '[squash-freeze-boundary-guard] Blocked: a manual full-root history flatten in a repo with a published release.',
    '',
    `  Where:  ${match.invocation}`,
    `  Saw:    ${WHAT[match.kind]}`,
    '  Wanted: every commit through the newest published release stays byte-identical (its SHA, and anything pinning it, must keep resolving).',
    '',
    '  This repo has shipped a real release, so a full-root flatten orphans',
    '  that release commit — the exact hazard squash-until-release.md exists',
    '  to prevent. Run the sanctioned runner instead; it freezes at the newest',
    '  published-release commit and collapses only the unreleased tail above it:',
    '',
    '    node .claude/skills/fleet/squashing-history/run.mts <repo-path>',
    '',
    '  Detail: docs/agents.md/fleet/squash-until-release.md',
  ]
  return lines.join('\n') + '\n'
}

export const check = bashGuard((command, payload): GuardResult => {
  const match = matchFreezeBoundaryFlatten(
    command,
    (payload as { cwd?: string | undefined } | undefined)?.cwd,
  )
  if (!match) {
    return undefined
  }
  return block(formatBlock(match))
})

export const hook = defineHook({
  bypass: ['squash-freeze-boundary'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
