#!/usr/bin/env node
// Claude Code PreToolUse hook — no-commit-ai-attribution-guard.
//
// Blocks a `git commit` tool call whose command text carries AI-attribution
// boilerplate ("Assisted-by: Claude Code:…", "Co-Authored-By: Claude",
// "🤖 Generated with …") before the commit exists. Fleet repos already strip
// attribution at the commit-msg git-hook stage and block it at pre-push, but
// this guard runs at the TOOL layer via the user-global dispatcher, so it
// also covers NON-fleet repos that have no fleet git hooks — the surface
// where the trailer kept landing (depscan, 2026-07-23: three PR branches
// needed history rewrites to strip it; one required a re-signing pass to
// satisfy the repo's verified-signature rule).
//
// Precedence, not correction: some repos (e.g. depscan) intentionally
// REQUIRE an attribution trailer as their own policy. This guard does not
// dispute that policy — it outranks it for the operator's sessions, the
// way a tool-layer deny always outranks repo instructions. Other agents
// and humans in those repos remain bound by the repo's rules.
//
// The detector is the SAME `containsAiAttribution` the git hooks and
// no-github-ai-attribution-guard use, imported from the gate-free shared
// module so the surfaces never diverge on what counts as attribution.
//
// Detection scans the WHOLE flattened command once a `git commit` segment is
// present — not just the extracted `-m` value — because commit messages are
// routinely passed via `-m "$(cat <<'EOF' … EOF)"` heredocs the arg parser
// cannot expand. The tradeoff (a compound that both commits and mentions an
// attribution string elsewhere gets blocked) is rare and bypassable.
//
// Skipped silently:
//   - tool_name !== 'Bash'.
//   - Command has no `git commit` segment.
//   - No attribution text anywhere in the command.
//
// Bypass: `Allow ai-attribution bypass` (same phrase as the gh/MCP prose
// guard — one surface for the operator).

import { containsAiAttribution } from '../../../../.git-hooks/_shared/ai-attribution.mts'
import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

// Dispatcher pre-flight: every `git commit` invocation carries the literal
// `commit` substring the dispatcher gates on before importing this guard.
export const triggers: readonly string[] = ['commit']

export const check = bashGuard(command => {
  if (!isGitCommit(command)) {
    return undefined
  }
  if (!containsAiAttribution(command)) {
    return undefined
  }
  return block(
    [
      '🚨 no-commit-ai-attribution-guard: blocked a `git commit` carrying',
      '   AI-attribution boilerplate in its message.',
      '',
      'Commit messages carry no AI byline — no "Assisted-by: …",',
      '"Co-Authored-By: Claude", "🤖 Generated with …", or similar.',
      'This wheelhouse rule takes PRECEDENCE over a repo CLAUDE.md that',
      'requires an attribution trailer (e.g. depscan) — do not add one',
      'even when the repo instructions ask for it.',
      '',
      'Fix: drop the attribution line(s) from the message and re-run.',
      '',
      'Bypass (the user must type verbatim in a recent turn):',
      '  `Allow ai-attribution bypass`',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['ai-attribution'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
