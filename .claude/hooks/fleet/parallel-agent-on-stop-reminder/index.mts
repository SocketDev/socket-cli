#!/usr/bin/env node
// Claude Code Stop hook — parallel-agent-on-stop-reminder.
//
// Fires at turn-end. Detects dirty paths in the checkout that THIS
// session did not author and that changed recently — the fingerprint
// of another Claude session (parallel agent, second terminal, or a
// worktree sharing the same `.git/`) working in the codebase at the
// same time. Emits a stderr reminder listing those foreign paths so
// the agent treats them cautiously: don't commit / revert / stash /
// stage them, stage only your own files by explicit path.
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
// Exit codes:
//   0 — always. Informational; never blocks (Stop hooks fire after the
//       turn ended — there's no tool call to refuse).
//

import process from 'node:process'

import {
  listForeignDirtyPaths,
  readTouchedPaths,
} from '../_shared/foreign-paths.mts'
import { readStdin } from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: StopPayload = {}
  try {
    payload = JSON.parse(raw) as StopPayload
  } catch {
    // Stop payload is optional for this hook; fall through with no
    // transcript (touched-set empty → every recent dirty path counts).
  }

  const repoDir = getProjectDir()
  if (!repoDir) {
    return
  }

  const touched = readTouchedPaths(payload.transcript_path)
  const foreign = listForeignDirtyPaths(repoDir, touched)
  if (foreign.length === 0) {
    return
  }

  process.stderr.write(
    `[parallel-agent-on-stop-reminder] ${foreign.length} dirty path(s) this session did not author and that changed recently — likely another agent on the same checkout:\n`,
  )
  for (const p of foreign.slice(0, 10)) {
    process.stderr.write(`  ${p}\n`)
  }
  if (foreign.length > 10) {
    process.stderr.write(`  ... and ${foreign.length - 10} more\n`)
  }
  process.stderr.write(
    '\nAnother Claude session may be working in this checkout. Be cautious:\n' +
      '  • Do NOT commit, revert, stash, or `git add -A` these paths —\n' +
      "    that sweeps up or destroys the other agent's in-flight work.\n" +
      '  • Stage only the files YOU authored, by explicit path.\n' +
      '  • If you saw these appear after your own build / check run, they\n' +
      "    are the other agent's edits landing — not your regression.\n" +
      '\nSee: CLAUDE.md → "Parallel Claude sessions"\n' +
      '     docs/claude.md/fleet/parallel-claude-sessions.md\n',
  )
}

main().catch(e => {
  process.stderr.write(
    `[parallel-agent-on-stop-reminder] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
})
