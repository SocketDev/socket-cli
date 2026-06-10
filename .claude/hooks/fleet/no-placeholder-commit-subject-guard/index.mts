#!/usr/bin/env node
// Claude Code PreToolUse hook — no-placeholder-commit-subject-guard.
//
// Blocks `git commit -m <msg>` / `--message=<msg>` tool calls whose
// subject line is a content-free placeholder (`wip`, `init`, `test`,
// `update`, `fix`, `.`, an empty string, …). This is the Claude-Bash
// twin of the commit-msg.mts placeholder backstop: the git-hook stage
// catches subprocess / worktree / CI / test-harness commits, this
// catches the same junk subject the moment Claude drafts a `git commit`
// tool call — before the diff is even staged, so the operator gets the
// nudge while the change is fresh.
//
// Why blocking, not reminder: a batch of `initial` / `wip` subjects is
// the fingerprint of a replayed or test-harness commit, and once landed
// on a branch the subject is permanent in `git log`. The fleet's two
// enforcement surfaces share ONE denylist — `.git-hooks/_shared/
// commit-subject.mts` — so the tool layer and the git-stage layer can
// never drift (CLAUDE.md "DRY across the two hook trees").
//
// DRY: the placeholder list + subject extraction live in
// `.git-hooks/_shared/commit-subject.mts` (canonical home, imported
// cross-tree exactly as commit-author-guard imports git-identity.mts);
// the `git commit -m` message extraction is reused from the sibling
// commit-message-format-guard hook. This hook re-implements neither.
//
// Skipped silently:
//   - tool_name !== 'Bash'.
//   - Command is not a `git commit` invocation.
//   - Command has no inline `-m` / `--message` subject (uses `-F file`,
//     `-e` editor, or a bare `git commit` — the editor / file / the
//     commit-msg git-stage backstop owns those forms).
//   - Bypass phrase present in a recent user turn.
//
// Reads a Claude Code PreToolUse JSON payload from stdin; exits 0
// (allow) or 2 (block + stderr explanation). Fails open on any internal
// error so the hook never wedges the operator's flow.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import {
  extractCommitMessage,
  isGitCommit,
} from '../_shared/commit-command.mts'
import { withBashGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import {
  commitSubject,
  isPlaceholderSubject,
} from '../../../../.git-hooks/_shared/commit-subject.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow placeholder-subject bypass'

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return
  }

  const message = extractCommitMessage(command)
  if (message === undefined) {
    // No inline `-m` / `--message`. The editor, `-F file`, or the
    // commit-msg git-stage backstop owns this form.
    return
  }

  const subject = commitSubject(message)
  if (!isPlaceholderSubject(subject)) {
    return
  }

  // Operator bypass — `Allow placeholder-subject bypass` in a recent turn.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }

  const saw = subject.trim() ? `"${subject}"` : 'an empty subject'
  logger.error(
    [
      `[no-placeholder-commit-subject-guard] Blocked: commit subject is a placeholder (${saw}).`,
      '',
      '  What : a commit subject must state what changed, not a',
      '         content-free placeholder like "wip" / "init" / "test" /',
      '         "update" / "." (the fingerprint of a replayed or',
      '         test-harness commit).',
      `  Where: the \`git commit -m\` subject in this tool call.`,
      `  Saw  : ${saw}.`,
      '  Fix  : rewrite as a Conventional Commits subject naming the',
      '         change, e.g. `fix(scan): handle empty manifest`.',
      '',
      '  If this junk subject is genuinely intentional, type',
      `  "${BYPASS_PHRASE}" in chat, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
