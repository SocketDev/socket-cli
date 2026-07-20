/**
 * @file Claude Code PreToolUse hook — sed-in-place-guard. BLOCKS a Bash
 *   command that edits files with an in-place stream editor: `sed -i` /
 *   `--in-place` (and gsed), `perl -pi` / `ruby -pi` style clusters, and
 *   gawk's `-i inplace`. Why: agents address these edits by LINE NUMBER or
 *   regex against a file state read earlier in the session — the file drifts
 *   (another actor commits, a linter reformats, an earlier edit shifts
 *   offsets) and the edit lands on the wrong region SILENTLY; there is no
 *   uniqueness check and no failure signal. (Live example: a
 *   `sed -i '' '2755,2757d'` aimed at a stale comment deleted a CSS rule
 *   body two turns after the numbers were read.) The sanctioned paths fail
 *   LOUD instead: the Edit tool anchors on exact current content and errors
 *   on mismatch, and scripted bulk edits assert unique content anchors
 *   (`assert old in s`) before replacing. Read-only sed (`sed -n '1,60p'`)
 *   is untouched. Bypass: `Allow sed-in-place bypass` typed verbatim in a
 *   recent user turn (single-use — genuine cases like a generated file too
 *   large for the Edit tool). Fails open on parse/payload errors — a guard
 *   bug must not wedge every Bash call. Detection tokenizes at COMMAND
 *   position via the shared `parseCommands` (shell-quote-backed) parser
 *   instead of a naive whitespace split, so a quoted argument — a `git commit
 *   -m 'mentions sed -i in prose'` — stays ONE token and never false-matches
 *   the editor name; only an actual invocation (bare or through `find -exec` /
 *   `xargs`) tokenizes the name as its own word.
 */

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

// Editor commands and the flag shapes that flip them into in-place mode.
// Perl/ruby clusters restrict the letters allowed BEFORE the `i` to the
// common wrapper flags (p/n/l/w and octal record separators) so `-Ilib`
// (include path, capital I with an attached value) does not false-positive.
const SED_NAMES = new Set(['gsed', 'sed'])
const PERLISH_NAMES = new Set(['perl', 'ruby'])
const AWK_NAMES = new Set(['awk', 'gawk'])
const PERLISH_IN_PLACE_RE = /^-[pnlw0-7]*i/
const SED_IN_PLACE_RE = /^(?:-[A-Za-z]*i|--in-place)/

/**
 * Return a human-readable reason when `command` performs an in-place stream
 * edit, else undefined. Pure — exported for tests. Scans every command
 * segment's binary + args (also catching `find … -exec sed -i` and `xargs
 * sed -i`, since those pass the editor name as a literal argument word) for
 * an editor name and inspects the dash-cluster tokens that follow it. Each
 * segment's tokens come from the shared quote-aware `parseCommands` parser,
 * so a quoted string (a commit message, a rg pattern) is one token and can
 * never be mistaken for a sequence of command-position words.
 */
export function detectInPlaceEdit(command: string): string | undefined {
  for (const cmd of parseCommands(command)) {
    if (!cmd.binary) {
      continue
    }
    const tokens = [cmd.binary, ...cmd.args]
    for (let i = 0, { length } = tokens; i < length; i += 1) {
      const name = tokens[i]!
      const isSed = SED_NAMES.has(name)
      const isPerlish = PERLISH_NAMES.has(name)
      const isAwk = AWK_NAMES.has(name)
      if (!isSed && !isPerlish && !isAwk) {
        continue
      }
      for (let j = i + 1; j < length; j += 1) {
        const arg = tokens[j]!
        if (!arg.startsWith('-')) {
          break
        }
        if (isSed && SED_IN_PLACE_RE.test(arg)) {
          return `\`${name} ${arg}\` edits files in place`
        }
        if (isPerlish && PERLISH_IN_PLACE_RE.test(arg)) {
          return `\`${name} ${arg}\` edits files in place`
        }
        if (
          isAwk &&
          (arg === '-iinplace' ||
            (arg === '-i' && tokens[j + 1]?.startsWith('inplace')))
        ) {
          return `\`${name} -i inplace\` edits files in place`
        }
      }
    }
  }
  return undefined
}

export function formatBlock(reason: string): string {
  return (
    [
      `[sed-in-place-guard] Blocked: ${reason}.`,
      '',
      '  In-place stream edits address the file by line number or pattern',
      '  from an EARLIER read — when the file has drifted (another actor,',
      '  a formatter, your own prior edit) they clobber the wrong region',
      '  silently. Use a path that fails loud instead:',
      '',
      '    • the Edit tool — anchors on exact current content, errors on',
      '      mismatch or a non-unique anchor',
      '    • Write — for whole-file rewrites you have just read',
      '    • scripted bulk edits — python/node with ASSERTED unique content',
      '      anchors (`assert old in s`), never line numbers',
    ].join('\n') + '\n'
  )
}

export const hook = defineHook({
  bypass: ['sed-in-place'],
  check: bashGuard((command, _payload) => {
    const reason = detectInPlaceEdit(command)
    if (!reason) {
      return undefined
    }
    return block(formatBlock(reason))
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
