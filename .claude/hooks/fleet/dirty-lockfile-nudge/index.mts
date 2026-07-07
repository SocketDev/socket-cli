#!/usr/bin/env node
// Claude Code PostToolUse hook — dirty-lockfile-nudge.
//
// After a `git` or `pnpm` Bash command, check whether `pnpm-lock.yaml`
// is dirty in the working tree. If it is, surface the canonical fix:
// run `pnpm i` to reconcile the lockfile before landing.
//
// Why: a dep edit (package.json), a workspace-shape change (a hook
// renamed/added under .claude/hooks/), or a cascade leaves
// `pnpm-lock.yaml` out of sync. Committing/landing the stale pair makes
// CI's `pnpm install --frozen-lockfile` reject the push — a
// local-passes / CI-fails trap. `pnpm i` regenerates the lockfile so it
// matches the manifests again; THEN commit it alongside the change.
//
// This hook detects:
//   1. PostToolUse Bash calls
//   2. Whose command ran `git` or `pnpm` (the operations that surface or
//      precede a lockfile drift — a commit, an add, a status, an install)
//   3. AND `git status --porcelain` shows a modified/staged pnpm-lock.yaml
//
// On match it returns a non-blocking notify reminder to run `pnpm i`. It
// does NOT run the install itself — `pnpm i` hits the network/Socket-firewall
// and can run build scripts, too heavy to fire blind from inside a fast
// hook; the agent runs it (the reminder names the exact command). The
// command gate keeps it quiet: a non-git/non-pnpm Bash call never triggers
// a `git status` probe.
//
// PostToolUse, not PreToolUse: we react to a lockfile that is already
// dirty; we don't predict it. Never blocks (notify, exit 0).

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Binaries whose use means the lockfile may have just drifted or is about
// to be committed. A `git commit`/`git add` is the land path; a `git
// status` is the moment a dirty lockfile becomes visible; a `pnpm`
// install/run is what regenerates (or fails to regenerate) it.
const TRIGGER_BINARIES = ['git', 'pnpm']

// The lockfile basename we reconcile. pnpm is the fleet package manager;
// there is exactly one lockfile name to watch.
const LOCKFILE_NAME = 'pnpm-lock.yaml'

export function commandTouchesTrigger(command: string): boolean {
  for (let i = 0, { length } = TRIGGER_BINARIES; i < length; i += 1) {
    if (commandsFor(command, TRIGGER_BINARIES[i]!).length > 0) {
      return true
    }
  }
  return false
}

// Porcelain status lines for any tracked pnpm-lock.yaml that is modified,
// staged, or otherwise not clean. A renamed lockfile surfaces as `R  old
// -> new`; we key off the basename appearing anywhere on the line so both
// the staged (`M `) and unstaged (` M`) columns count.
export function dirtyLockfilesFromPorcelain(out: string): string[] {
  const dirty: string[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const filePath = arrow === -1 ? rest : rest.slice(arrow + 4)
    const normalized = normalizePath(filePath)
    if (
      normalized === LOCKFILE_NAME ||
      normalized.endsWith(`/${LOCKFILE_NAME}`)
    ) {
      dirty.push(normalized)
    }
  }
  return dirty
}

export function listDirtyLockfiles(repoDir: string): string[] {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    timeout: 5000,
  })
  if (r.status !== 0) {
    return []
  }
  return dirtyLockfilesFromPorcelain(String(r.stdout))
}

// `git diff HEAD` for the lockfile — captures staged + unstaged changes vs the
// last commit, so a dropped workspace member is visible even once its lockfile
// delta is staged.
export function lockfileDiff(repoDir: string): string {
  const r = spawnSync('git', ['diff', 'HEAD', '--', LOCKFILE_NAME], {
    cwd: repoDir,
    timeout: 5000,
  })
  if (r.status !== 0) {
    return ''
  }
  return String(r.stdout)
}

// Removed `importers:` keys in a lockfile diff — a workspace package that
// VANISHED. Importer keys sit at 2-space indent and are repo-relative paths
// (`.` or a `/`-containing path with no `@version`); a removed dep/package key
// is deeper-indented or carries an `@version`, so neither is mistaken for a
// vanished member. A dropped importer means a package/hook DIR is gone — a
// `pnpm i` blesses the removal rather than restoring it, so it is escalated.
export function removedImporterPaths(diff: string): string[] {
  const removed: string[] = []
  for (const line of diff.split('\n')) {
    const m = /^-  (\S[^:]*):\s*$/.exec(line)
    if (!m) {
      continue
    }
    const key = m[1]!
    if (key === '.' || (key.includes('/') && !key.includes('@'))) {
      removed.push(key)
    }
  }
  return removed
}

export function formatReminder(lockfiles: readonly string[]): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ dirty-lockfile-nudge')
  lines.push('')
  const which =
    lockfiles.length === 1
      ? `\`${lockfiles[0]}\` is`
      : `${lockfiles.length} \`${LOCKFILE_NAME}\` files are`
  lines.push(`${which} dirty in the working tree.`)
  lines.push('')
  lines.push("A stale lockfile fails CI's `pnpm install --frozen-lockfile` — a")
  lines.push('local-passes / CI-fails trap. Reconcile it before landing:')
  lines.push('')
  lines.push('  pnpm i')
  lines.push('')
  lines.push(
    'then commit the regenerated lockfile alongside your change. Do NOT',
  )
  lines.push('hand-edit the lockfile or commit the stale pair.')
  lines.push('')
  lines.push(
    'Do not disown it ("not mine / already dirty at session start") — a',
  )
  lines.push(
    '`pnpm i` or a pre-commit reconciled it, not the user. If `pnpm i` leaves',
  )
  lines.push(
    'ONLY the lockfile changed (manifests untouched), it is already up to date:',
  )
  lines.push('commit it alone and move on with')
  lines.push('')
  lines.push(
    '  git commit -o pnpm-lock.yaml --no-verify -m "chore: reconcile lockfile"',
  )
  lines.push('')
  lines.push('The lockfile-only `-o … --no-verify` reconcile is sanctioned by')
  lines.push(
    'no-revert-guard — `-o` keeps it lockfile-only, so nothing else rides in.',
  )
  lines.push('')
  return lines.join('\n')
}

// Escalated reminder: the lockfile lost a workspace importer — a package/hook
// directory vanished. Distinct from a benign dep drift because `pnpm i` accepts
// (blesses) the deletion rather than fixing it; the dir must be restored FIRST
// if its removal was unintended (e.g. a cascade orphan-removing a tracked
// template hook from live — the concurrent-cargo-build-guard drift).
export function formatVanishedMemberWarning(
  removed: readonly string[],
): string {
  const lines: string[] = []
  lines.push('')
  lines.push('⚠ dirty-lockfile-nudge — WORKSPACE MEMBER VANISHED')
  lines.push('')
  lines.push(
    `\`${LOCKFILE_NAME}\` dropped ${removed.length} workspace importer(s):`,
  )
  for (let i = 0, { length } = removed; i < length; i += 1) {
    lines.push(`  - ${removed[i]}`)
  }
  lines.push('')
  lines.push('A workspace package/hook directory is gone. `pnpm i` will BLESS')
  lines.push('the removal, NOT restore it. Before reconciling, confirm the dir')
  lines.push('SHOULD be gone — if it is a tracked template hook the cascade')
  lines.push('orphan-removed from live, restore it (and `git add` it) first,')
  lines.push('THEN run `pnpm i` to reconcile the lockfile.')
  lines.push('')
  return lines.join('\n')
}

export function getRepoDir(payload: ToolCallPayload): string | undefined {
  // The repo the command ACTS on — a `cd <sibling> && pnpm i` targets that
  // repo's lockfiles, not the session repo's (actedOnPath honors cd targets,
  // then the payload cwd).
  return (
    actedOnPath(payload) || process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
  )
}

export const check = bashGuard((command, payload) => {
  if (!commandTouchesTrigger(command)) {
    return undefined
  }
  const repoDir = getRepoDir(payload)
  /* c8 ignore next - getRepoDir falls back to process.cwd(), always non-empty */
  if (!repoDir) {
    return undefined
  }
  const dirty = listDirtyLockfiles(repoDir)
  if (dirty.length === 0) {
    return undefined
  }
  // A vanished workspace importer is a structural drift `pnpm i` can't fix —
  // escalate it above the routine reconcile nudge.
  const removed = removedImporterPaths(lockfileDiff(repoDir))
  if (removed.length > 0) {
    return notify(formatVanishedMemberWarning(removed))
  }
  return notify(formatReminder(dirty))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
