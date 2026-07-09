/*
 * @file Claude Code PreToolUse hook — zsh-word-split-nudge.
 *
 * The fleet's interactive shell is zsh, and zsh does NOT word-split
 * unquoted parameter expansions (no SH_WORD_SPLIT). A variable built as
 * a space-joined list —
 *
 *   files=$(find test -name '*.test.mts' | tr '\n' ' ')
 *   vitest run $files            # zsh: ONE argument, matches nothing
 *
 * — silently passes as a single argument. Paired with tools that exit 0
 * on zero matches (vitest passWithNoTests, rg -l, xargs -r), the failure
 * is invisible: the command "succeeds" having done nothing.
 *
 * Working alternatives:
 *   - command substitution (zsh DOES split it):  vitest run $(cat /tmp/list)
 *   - forced splitting:                          vitest run ${=files}
 *   - a pipe into xargs:                         ... | xargs vitest run
 *
 * This hook fires when a Bash command both (a) assigns a variable from a
 * command substitution that produces a multi-entry list (`tr '\n' ' '`,
 * `find`, `ls`, `grep -l` / `rg -l` pipelines) and (b) later expands that
 * variable unquoted as a standalone argument. Stderr reminder; never
 * blocks. Skips `${=name}` (already split), `"${name}"`/`"$name"`
 * (deliberately one word), and `${name[@]}` (array expansion).
 */

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'

// Assignment whose right side is a command substitution that plausibly
// builds a list: name=$( ... find/ls/grep -l/rg -l ... ) or any $( ) that
// pipes through `tr '\n' ' '`.
const LIST_ASSIGN_RE =
  // socket-lint: allow uncommented-regex -- broken down in the comment above.
  /(?:^|[\s;&|(])(?<name>[A-Za-z_]\w*)=\$\((?<rhs>[^)]*)\)/g

// A list-producing right side: newline-to-space flattening, or a
// file-enumerating command anywhere in the pipeline.
function looksLikeListRhs(rhs: string): boolean {
  return (
    /tr\s+(?:'\\n'|"\\n"|\\n)\s+/.test(rhs) ||
    /(?:^|[\s;&|(])(?:find|ls|fd)\s/.test(rhs) ||
    /(?:grep|rg)\s+(?:-\w*l|--files-with-matches)/.test(rhs)
  )
}

export function detectsUnsplitListVar(command: string): string | undefined {
  const flat = command.replace(/\\\n/g, ' ')
  let m: RegExpExecArray | null
  while ((m = LIST_ASSIGN_RE.exec(flat)) !== null) {
    const name = m.groups!['name']!
    if (!looksLikeListRhs(m.groups!['rhs']!)) {
      continue
    }
    // Unquoted bare `$name` used as a standalone argument after the
    // assignment. `${=name}` (forced split), quoted forms, and array
    // expansions are fine.
    const after = flat.slice(m.index + m[0].length)
    const bareUse = new RegExp(`[^"'={\\w]\\$${name}(?![\\w}])`).test(after)
    if (bareUse) {
      return name
    }
  }
  return undefined
}

export const hook = defineHook({
  check: bashGuard(command => {
    const name = detectsUnsplitListVar(command)
    if (name === undefined) {
      return undefined
    }
    return notify(
      [
        `[zsh-word-split-nudge] \`$${name}\` holds a space-joined list but zsh will pass it as ONE argument.`,
        '',
        '  zsh does not word-split unquoted parameter expansions (no',
        '  SH_WORD_SPLIT). Tools that exit 0 on zero matches (vitest',
        '  passWithNoTests, xargs -r) make the miss invisible — the command',
        '  "succeeds" having matched nothing.',
        '',
        '  Pass the list one of these ways instead:',
        '',
        '    (a) command substitution — zsh DOES split it:',
        '          vitest run $(cat /tmp/list.txt)',
        '',
        `    (b) forced splitting:  \${=${name}}`,
        '',
        '    (c) pipe into xargs:   find … | xargs -n50 vitest run',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
