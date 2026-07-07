#!/usr/bin/env node
// Claude Code PreToolUse hook — issue-autolink-nudge.
//
// On a Bash command that writes to a public Git or GitHub surface (a commit,
// or a pr, issue, comment, or release body), warn when the text contains a
// bare `#N`. GitHub auto-links `#3` into a reference to issue or PR 3 of the
// target repo — so a `#3` that meant "list item 3" or "task 3" silently turns
// into a cross-reference to an unrelated issue. Suggest backticking it
// (`` `#3` ``) or reshaping ("item 3").
//
// Advisory only — a bare `#N` is sometimes a deliberate, correct reference.
// The nudge just prompts the author to confirm intent before it sends. Never
// blocks (notify, exit 0). Universal: bare `#N` auto-links on ANY GitHub repo,
// so this is not fleet-scoped. Internal task lists in the agent's own prose
// (never sent to a public surface) are unaffected.

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { isPublicSurface } from '../_shared/public-surfaces.mts'

export const triggers: readonly string[] = ['gh', 'git']

// A bare `#N`: a `#` immediately followed by digits, NOT preceded by a backtick
// (already code-formatted) or a word char (so `abc#3` and `v1.2.3#4` don't
// count). A `#L12` line anchor starts with a letter, so it never matches. This
// scans message text for a display artifact, not shell-command structure.
const BARE_ISSUE_REF_RE = /(?<![`\w])#(\d+)\b/g

export function findBareIssueRefs(text: string): string[] {
  const seen = new Set<string>()
  let match: RegExpExecArray | null = BARE_ISSUE_REF_RE.exec(text)
  while (match) {
    seen.add(`#${match[1]!}`)
    match = BARE_ISSUE_REF_RE.exec(text)
  }
  return [...seen]
}

export const check = bashGuard(command => {
  if (!isPublicSurface(command)) {
    return undefined
  }
  const refs = findBareIssueRefs(command)
  if (!refs.length) {
    return undefined
  }
  return notify(
    [
      '[issue-autolink-nudge] This command writes to a public GitHub surface',
      `  and contains a bare reference: ${refs.join(', ')}.`,
      '',
      '  GitHub auto-links `#N` to issue or PR N of the target repo. If you',
      '  meant a list item or task number (not that issue), it becomes a wrong',
      '  cross-reference once it sends.',
      '',
      '  • A real issue or PR reference? Leave it — that is the intended link.',
      '  • Otherwise wrap it in backticks (`#3`) or reshape ("item 3", "task 3")',
      '    before the command runs.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
