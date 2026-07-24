#!/usr/bin/env node
// Claude Code SessionStart hook — memory-discovery-nudge.
//
// Persistent file-based memory lives OUTSIDE the repo, under the user's home:
//   ~/.claude/projects/<slug>/memory/   (slug = absolute project path, "/" → "-")
// keyed to the session's cwd. It is per-user, per-cwd — NOT committed, NOT shared
// across checkouts, NOT inherited by spawned subagents. So a session has no way to
// know it exists, or that a DIFFERENT repo's memory (e.g. the fleet-wide wheelhouse
// store) is the right place for a given fact, unless told.
//
// This hook tells it, at session start:
//   1. Where THIS repo's memory store is (resolved generically from cwd).
//   2. Where the shared FLEET/wheelhouse store is (the cross-repo brain) — so a
//      fact owned by the fleet gets filed there, not siloed under whatever repo
//      the session happens to be standing in.
//   3. The filing convention: remember a fact in the store of the repo that OWNS
//      it; resolve any repo's store as ~/.claude/projects/<abs-path "/"→"-">/memory/.
//
// Only surfaces a store that actually exists + has a MEMORY.md index (silent
// otherwise, so empty/new projects add no noise). Pure-informational: never
// blocks, never writes, never fails the session.

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// The wheelhouse is the fleet's shared memory store — facts that apply to every
// fleet repo (canonical rules, cascade mechanics, cross-repo standards) belong
// here, NOT under the repo a session happens to be in. Resolved by the wheelhouse
// checkout's conventional sibling location relative to the current repo's parent.
const WHEELHOUSE_DIR_NAME = 'socket-wheelhouse'

// Slugify an absolute project path the way the harness keys its memory store:
// every "/" (including the leading one) becomes "-".
export function projectSlug(absPath: string): string {
  return absPath.replace(/\//g, '-')
}

// The memory dir for a given absolute project path, or undefined if the path is
// not absolute (can't be slugified into a stable key).
export function memoryDirFor(absPath: string): string | undefined {
  if (!absPath || !path.isAbsolute(absPath)) {
    return undefined
  }
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    projectSlug(absPath),
    'memory',
  )
}

// A store counts as "present" only when it has a MEMORY.md index to read.
export function storeHasIndex(memoryDir: string | undefined): boolean {
  return (
    memoryDir !== undefined && existsSync(path.join(memoryDir, 'MEMORY.md'))
  )
}

// Resolve the sibling wheelhouse checkout's path from the current cwd. Fleet
// repos are checked out as siblings (…/projects/socket-btm, …/projects/socket-
// wheelhouse), so the wheelhouse is <parent-of-cwd>/socket-wheelhouse.
export function wheelhousePathFrom(cwd: string): string | undefined {
  if (!cwd || !path.isAbsolute(cwd)) {
    return undefined
  }
  return path.join(path.dirname(cwd), WHEELHOUSE_DIR_NAME)
}

// Build the session-start hint, or undefined when neither store is discoverable.
// Pure — the test drives it directly.
export function memoryHint(cwd: string): string | undefined {
  const repoMemory = memoryDirFor(cwd)
  const wheelhousePath = wheelhousePathFrom(cwd)
  const fleetMemory = wheelhousePath ? memoryDirFor(wheelhousePath) : undefined

  const repoPresent = storeHasIndex(repoMemory)
  // The fleet store is only "other" when this session isn't already IN the
  // wheelhouse (else repo == fleet and we'd point at ourselves).
  const inWheelhouse =
    repoMemory !== undefined &&
    fleetMemory !== undefined &&
    repoMemory === fleetMemory
  const fleetPresent = !inWheelhouse && storeHasIndex(fleetMemory)

  if (!repoPresent && !fleetPresent) {
    return undefined
  }

  const lines: string[] = [
    'This repo has persistent file-based memory (per-user, per-cwd, NOT committed). ' +
      'Convention: remember a fact in the store of the repo that OWNS it — ' +
      'fleet/cross-repo facts go in the wheelhouse store, this-repo facts go here. ' +
      'Resolve any repo’s store as ~/.claude/projects/<abs-path with "/"→"-">/memory/.',
  ]
  if (repoPresent) {
    lines.push(`This repo's memory: ${repoMemory} (read its MEMORY.md index).`)
  }
  if (fleetPresent) {
    lines.push(
      `Shared FLEET (wheelhouse) memory: ${fleetMemory} (read its MEMORY.md) — ` +
        'file fleet-wide facts THERE, not under this repo.',
    )
  }
  return lines.join(' ')
}

export const check = () => {
  const hint = memoryHint(resolveProjectDir())
  if (!hint) {
    return undefined
  }
  return notify(`[memory-discovery] ${hint}`)
}

export const hook = defineHook({
  check,
  event: 'SessionStart',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
