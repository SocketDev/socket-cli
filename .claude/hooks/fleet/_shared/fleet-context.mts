/*
 * @file `isFleetTarget` — does a tool call act on a fleet-managed repo?
 *
 *   Fleet CONVENTION guards (oxfmt/oxlint specifics, code-style, claude-md,
 *   cascade, markdown-filename, private-name) only make sense inside a fleet
 *   repo; outside it — a sibling non-fleet clone, /tmp, an external review
 *   clone under ~/.socket/_wheelhouse/repo-clones/ — they misfire, and the
 *   operator can't even self-authorize a bypass because the fleet tooling isn't
 *   installed there. Such guards gate on isFleetTarget and no-op outside.
 *
 *   Universal SAFETY guards (secrets, prompt/shell injection, supply-chain,
 *   work-loss) must NOT consult this — they fire everywhere.
 *
 *   Fail-SAFE: when membership can't be determined (no git / git unavailable),
 *   treat the target AS fleet so a convention guard errs toward firing rather
 *   than silently dropping a check.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isEphemeralPath } from './ephemeral-path.mts'
import { containsFleetBeginMarker } from './fleet-markers.mts'
import { isFleetRepo, slugFromRemoteUrl } from './fleet-repos.mts'
import { gitOut } from './git-branch.mts'
import { parseCommands } from './shell-command.mts'
import type { ToolCallPayload } from './payload.mts'
import { resolveProjectDir } from './project-dir.mts'

/**
 * The effective directory a Bash command runs in: a leading/`&&`-chained
 * `cd <dir>` moves it OUT of the shell's start cwd. A wheelhouse-rooted session
 * running `cd /path/to/other-repo && rustfmt …` acts on other-repo — so fleet
 * membership must be judged there, not at the wheelhouse cwd. Returns the last
 * `cd` target (resolved against `cwd`), or `undefined` when the command never
 * changes directory.
 */
// A `cd` to a windows drive-letter path, extracted from the RAW command:
// shell-quote applies POSIX escape semantics, so `cd C:\Users\x` tokenizes to
// `C:Usersx` — the mangled dir then fails git resolution and fleet detection
// fails SAFE to fleet, false-blocking non-fleet work on windows (gotchas doc,
// class 7). Anchored at command position (start / separator before `cd`);
// quoted and bare forms.
// cd\s+ — the cd token + gap; then one of:
//   "([A-Za-z]:[\\/][^"]*)" — double-quoted drive path
//   '([A-Za-z]:[\\/][^']*)' — single-quoted drive path
//   ([A-Za-z]:[\\/][^\s&|;)"']*) — bare drive path up to a separator
const WIN_CD_RE =
  /(?:^|[\s;&|(])cd\s+(?:"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'|([A-Za-z]:[\\/][^\s&|;)"']*))/g

export function lastCdTarget(command: string, cwd: string): string | undefined {
  let target: string | undefined
  let sawDriveishCd = false
  for (const cmd of parseCommands(command)) {
    if (cmd.binary && path.basename(cmd.binary) === 'cd') {
      const arg = cmd.args.find(a => !a.startsWith('-'))
      if (arg) {
        // A parsed cd arg like `C:UsersTempx` is the de-backslashed residue of
        // a windows path — the marker that the raw-recovery lane below applies.
        sawDriveishCd ||= /^[A-Za-z]:/.test(arg)
        target = path.isAbsolute(arg) ? arg : path.resolve(target ?? cwd, arg)
      }
    }
  }
  if (!sawDriveishCd) {
    return target
  }
  // Windows-drive lane: recover backslash targets from the raw command (the
  // tokenizer ate their backslashes in `target`). Gated on the PARSED loop
  // having seen a real drive-ish cd — a raw-only regex would harvest prose
  // (an echo'd string mentioning a cd) as a target, the substring-scanner
  // class. The LAST drive-shaped cd wins, matching the loop above; absolute
  // by construction, so no resolve against cwd.
  let winTarget: string | undefined
  let m: RegExpExecArray | null
  WIN_CD_RE.lastIndex = 0
  while ((m = WIN_CD_RE.exec(command)) !== null) {
    winTarget = m[1] ?? m[2] ?? m[3]
  }
  return winTarget ?? target
}

// The filesystem location a tool call acts on: an Edit/Write file's directory,
// else — for Bash — the effective cwd AFTER any `cd` in the command, else the
// command's declared cwd, else the process cwd. Honoring the `cd` is what lets a
// fleet-rooted session's `cd <non-fleet-repo> && <formatter>` be judged against
// the non-fleet repo (so the fleet linter/convention guards no-op there).
export function actedOnPath(payload: ToolCallPayload): string {
  const input = payload?.tool_input
  const filePath =
    input && typeof input.file_path === 'string' ? input.file_path : undefined
  if (filePath) {
    return path.dirname(filePath)
  }
  const cwd = resolveProjectDir(payload?.cwd)
  const command =
    input && typeof input.command === 'string' ? input.command : undefined
  if (command) {
    const cdTarget = lastCdTarget(command, cwd)
    if (cdTarget) {
      return cdTarget
    }
  }
  return cwd
}

function safeReadFile(filePath: string): string | undefined {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined
  } catch {
    return undefined
  }
}

// Decide membership for a resolved repo root. Confident non-fleet → false;
// confident fleet (roster slug or fleet-canonical CLAUDE.md) → true.
export function isFleetRepoRoot(repoRoot: string): boolean {
  const norm = normalizePath(repoRoot)
  // External review clones live here by convention — never fleet-managed.
  if (/\/\.socket\/_wheelhouse\/repo-clones\//.test(norm)) {
    return false
  }
  // A named fleet repo, identified by its GitHub remote slug.
  const remote = gitOut(repoRoot, ['config', '--get', 'remote.origin.url'])
  const slug = remote ? slugFromRemoteUrl(remote.trim()) : undefined
  // Under SOCKET_DEBUG, narrate the membership inputs: a windows CI run
  // resolved a roster-remoted fixture NON-fleet (skipping a fleet-only gate)
  // and only these inputs can say which arm diverged — the git config read,
  // the slug parse, or the roster lookup.
  if (process.env['SOCKET_DEBUG']) {
    process.stderr.write(
      `[fleet-context] isFleetRepoRoot: root ${norm}, remote ${remote ?? '<none>'}, slug ${slug ?? '<none>'}, roster ${slug ? isFleetRepo(slug) : 'n/a'}\n`,
    )
  }
  if (slug) {
    return isFleetRepo(slug)
  }
  // No remote: structural signal — a fleet checkout carries the fleet hook tree
  // AND the fleet-canonical CLAUDE.md marker block.
  if (existsSync(path.join(repoRoot, '.claude', 'hooks', 'fleet'))) {
    const md = safeReadFile(path.join(repoRoot, 'CLAUDE.md'))
    if (md && containsFleetBeginMarker(md)) {
      return true
    }
  }
  return false
}

const ROOT_CACHE = new Map<string, boolean>()

export function isFleetTarget(payload: ToolCallPayload): boolean {
  const dir = actedOnPath(payload)
  const root = gitOut(dir, ['rev-parse', '--show-toplevel'])?.trim()
  if (!root) {
    // Not a git repo, or git unavailable — membership unknown. A
    // session-scratchpad / temp working draft (isEphemeralPath) is never fleet
    // source, so resolve it NON-fleet and let a convention guard skip it. Any
    // other undeterminable path fails SAFE to fleet so a guard still fires.
    return !isEphemeralPath(dir)
  }
  const cached = ROOT_CACHE.get(root)
  if (cached !== undefined) {
    return cached
  }
  const result = isFleetRepoRoot(root)
  ROOT_CACHE.set(root, result)
  return result
}
