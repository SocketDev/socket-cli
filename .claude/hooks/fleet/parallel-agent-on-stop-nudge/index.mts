#!/usr/bin/env node
// Claude Code Stop hook — parallel-agent-on-stop-nudge.
//
// Fires at turn-end. Lists dirty paths that THIS session's edits didn't
// produce and that changed recently. The forgiving read comes FIRST:
// these are most likely the session's OWN earlier work (recall resets
// across compaction) or an aligned session heading the same way — not a
// rival. The nudge points at `whose-work` to confirm and `land-work` to
// land them toward local main, and warns only against the destructive
// sweeps (`git add -A` / revert / stash) that would clobber unfamiliar
// work. A genuine collision is a file mutating mid-turn, which a turn-end
// snapshot can't see.
//
// Why this exists (incident 2026-05-27, socket-lib): a session running
// `pnpm run check` / build saw ~6 dirty files it never touched (an
// esbuild->rolldown migration another agent was mid-flight on) and
// nearly investigated them as its own regression, then nearly swept
// them into a commit. Nothing warned it. CLAUDE.md "Parallel Claude
// sessions" states the rule; this hook makes the live signal visible
// at the turn that surfaced it.
//
// Heuristic lives in `_shared/foreign-paths.mts` (shared with
// overeager-staging-guard + parallel-agent-staging-guard): foreign =
// dirty AND not in this session's transcript touched-set AND mtime
// recent. Vendored / build-copied trees are excluded.
//
// Verdict: notify (never blocks). Stop hooks fire after the turn ended —
// there's no tool call to refuse.

import process from 'node:process'

import {
  listForeignDirtyPaths,
  readTouchedPaths,
} from '../_shared/foreign-paths.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const repoDir = getProjectDir()
  /* c8 ignore start - process.cwd() always returns a string; this branch is unreachable */
  if (!repoDir) {
    return undefined
  }
  /* c8 ignore stop */

  const touched = readTouchedPaths(payload.transcript_path)
  const foreign = listForeignDirtyPaths(repoDir, touched)
  if (foreign.length === 0) {
    return undefined
  }

  let message = `[parallel-agent-on-stop-nudge] ${foreign.length} dirty path(s) not from this session's edits (changed recently):\n`
  for (const p of foreign.slice(0, 10)) {
    message += `  ${p}\n`
  }
  if (foreign.length > 10) {
    message += `  ... and ${foreign.length - 10} more\n`
  }
  message +=
    '\nMost likely these are your OWN earlier work (recall resets across\n' +
    'compaction) or an aligned session heading the same way — not a rival.\n' +
    'Landing to local main is the goal:\n' +
    '  • Confirm before assuming a parallel session — run\n' +
    '    `node scripts/fleet/whose-work.mts`. Unfamiliar ≠ foreign.\n' +
    '  • Prefer LANDING them — `node scripts/fleet/land-work.mts --commit`\n' +
    '    (or surgical `git commit -o <file>`) — over leaving them dirty.\n' +
    '  • Do NOT `git add -A` / revert / stash paths you did not just author;\n' +
    '    a surgical commit keeps the index clean without sweeping them.\n' +
    '  • A real collision is a file changing between two of your OWN reads\n' +
    '    THIS turn — that alone warrants pausing.\n' +
    '\nSee: docs/agents.md/fleet/parallel-claude-sessions.md\n'

  return notify(message)
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
