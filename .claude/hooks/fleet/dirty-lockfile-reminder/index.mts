#!/usr/bin/env node
// Claude Code PostToolUse hook — dirty-lockfile-reminder.
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
// On match it writes a stderr reminder to run `pnpm i`. It does NOT run
// the install itself — `pnpm i` hits the network/Socket-firewall and can
// run build scripts, too heavy to fire blind from inside a fast hook;
// the agent runs it (the reminder names the exact command). The command
// gate keeps it quiet: a non-git/non-pnpm Bash call never triggers a
// `git status` probe.
//
// PostToolUse, not PreToolUse: we react to a lockfile that is already
// dirty; we don't predict it. Fail-open on hook bugs (exit 0).

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { commandsFor } from '../_shared/shell-command.mts'

interface Payload {
  readonly hook_event_name?: string | undefined
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly cwd?: string | undefined
}

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
    const normalized = filePath.replace(/\\/g, '/')
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
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  return dirtyLockfilesFromPorcelain(String(r.stdout))
}

export function formatReminder(lockfiles: readonly string[]): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ dirty-lockfile-reminder')
  lines.push('')
  const which =
    lockfiles.length === 1
      ? `\`${lockfiles[0]}\` is`
      : `${lockfiles.length} \`${LOCKFILE_NAME}\` files are`
  lines.push(`${which} dirty in the working tree.`)
  lines.push('')
  lines.push(
    'A stale lockfile fails CI\'s `pnpm install --frozen-lockfile` — a',
  )
  lines.push('local-passes / CI-fails trap. Reconcile it before landing:')
  lines.push('')
  lines.push('  pnpm i')
  lines.push('')
  lines.push(
    'then commit the regenerated lockfile alongside your change. Do NOT',
  )
  lines.push('hand-edit the lockfile or commit the stale pair.')
  lines.push('')
  return lines.join('\n')
}

async function readStdin(): Promise<string> {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return raw
}

export function getRepoDir(payload: Payload): string | undefined {
  return payload.cwd || process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }
  if (payload.hook_event_name !== 'PostToolUse') {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.command
  if (!command || !commandTouchesTrigger(command)) {
    process.exit(0)
  }
  const repoDir = getRepoDir(payload)
  if (!repoDir) {
    process.exit(0)
  }
  const dirty = listDirtyLockfiles(repoDir)
  if (dirty.length === 0) {
    process.exit(0)
  }
  process.stderr.write(formatReminder(dirty))
  // Exit 0 — informational only; never blocks the turn.
  process.exit(0)
}

main().catch(() => {
  // Fail-open.
  process.exit(0)
})
