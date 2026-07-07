#!/usr/bin/env node
// Claude Code PreToolUse hook — no-github-ai-attribution-guard.
//
// Blocks a `gh` invocation that would post AI-attribution boilerplate
// ("Assisted-by: Claude Code:opus-4-8", "Co-Authored-By: Claude",
// "🤖 Generated with Claude", a `claude.ai/code/session_` URL, …) onto a
// PUBLIC GitHub prose surface — anywhere the agent can post a comment or
// write a summary: PR body + title, PR/issue/commit comments, PR reviews,
// issue body + title, release notes, discussions (via the API), and gists.
//
// Commit MESSAGES are out of scope here — the commit-msg git hook strips
// attribution from them and pre-push blocks it; this guard covers the prose
// surfaces those hooks never see. The detector is the SAME
// `containsAiAttribution` both use, imported from the gate-free shared module
// so the guard and the git hooks never diverge on what counts as attribution.
//
// Detection is AST-based (the fleet `shell-command` parser), not regex — it
// sees through quoting, `&&`/`|`/`;` chains, and `$(…)`.
//
// Fix: remove the attribution footer/line from the prose flag value and re-run.
//      A human PR summary doesn't need an AI byline (CLAUDE.md → no AI
//      attribution).
//
// Bypass: `Allow ai-attribution bypass`.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

import { containsAiAttribution } from '../../../../.git-hooks/_shared/ai-attribution.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow ai-attribution bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Dispatcher pre-flight: every covered command is a `gh` invocation, so a
// payload without `gh` can't match and the dispatcher skips this guard.
export const triggers: readonly string[] = ['gh']

// `gh` subcommands (first non-flag arg) that post prose to a public surface.
const PROSE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'api', // commit comments + GraphQL discussions carry a body= field
  'discussion',
  'gist',
  'issue',
  'pr',
  'release',
])

// Flags whose value is human-facing prose (a body, title, or release notes).
const PROSE_FLAGS: ReadonlySet<string> = new Set([
  '--body',
  '--body-text',
  '--notes',
  '--title',
  '-b',
  '-t',
])

// `gh api` field flags — the value is a `body=…` / `title=…` kv string.
const API_FIELD_FLAGS: ReadonlySet<string> = new Set([
  '--field',
  '--raw-field',
  '-F',
  '-f',
])

/**
 * Pull every prose token a `gh` command would post: body / title / notes flag
 * values and `gh api` `body=` / `title=` fields, from the AST-parsed args
 * (already unquoted, chain- and `$(…)`-aware). `--body-file` / `--notes-file`
 * (file paths) are out of scope — we only inspect args-as-text.
 */
export function extractProse(command: string): string {
  const out: string[] = []
  for (const cmd of commandsFor(command, 'gh')) {
    const { args } = cmd
    const isProse = args.some(
      a => !a.startsWith('-') && PROSE_SUBCOMMANDS.has(a),
    )
    if (!isProse) {
      continue
    }
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (PROSE_FLAGS.has(arg)) {
        const value = args[i + 1]
        if (value !== undefined) {
          out.push(value)
        }
        continue
      }
      const eq = arg.indexOf('=')
      if (eq > 0 && PROSE_FLAGS.has(arg.slice(0, eq))) {
        out.push(arg.slice(eq + 1))
        continue
      }
      if (API_FIELD_FLAGS.has(arg)) {
        const value = args[i + 1]
        if (
          value !== undefined &&
          (value.startsWith('body=') || value.startsWith('title='))
        ) {
          out.push(value.slice(value.indexOf('=') + 1))
        }
      }
    }
  }
  return out.join('\n')
}

export const check = bashGuard((command, payload) => {
  const prose = extractProse(command)
  if (!prose || !containsAiAttribution(prose)) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  return block(
    [
      '🚨 no-github-ai-attribution-guard: blocked a gh command posting',
      '   AI-attribution boilerplate to a public GitHub prose surface',
      '   (PR/issue body or title, PR/issue/commit comment, review, release',
      '   notes, discussion, or gist).',
      '',
      'A human-facing summary / comment must not carry an AI byline',
      '("Assisted-by: …", "Co-Authored-By: Claude", "🤖 Generated with …",',
      'a claude.ai/code/session_ URL, etc.) — CLAUDE.md → no AI attribution.',
      '',
      'Fix: remove the attribution footer/line from the body/title/notes value',
      'and re-run the command.',
      '',
      `Bypass (the user must type verbatim in a recent turn): \`${BYPASS_PHRASE}\``,
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
