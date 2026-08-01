/*
 * @file Claude Code PreToolUse hook — zsh-word-split-guard.
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
 * The EMPTY case is worse still: an empty list leaves no argument at all, so
 * the tool falls back to its default input. `rg -c pat $files` with `files`
 * unset scans the whole tree and returns a confident answer about the wrong
 * thing. That is why this BLOCKS rather than advises — both shapes yield a
 * wrong measurement that reads as a successful one.
 *
 * Working alternatives:
 *   - command substitution (zsh DOES split it):  vitest run $(cat /tmp/list)
 *   - forced splitting:                          vitest run ${=files}
 *   - a pipe into xargs:                         ... | xargs vitest run
 *
 * This hook fires when a Bash command both (a) assigns a variable from a
 * command substitution that produces a multi-entry list (`tr '\n' ' '`,
 * `find`, `ls`, `grep -l` / `rg -l` pipelines) and (b) later expands that
 * variable unquoted as a standalone argument. Blocks, with
 * `Allow zsh-word-split bypass` for the rare deliberate case. Skips
 * `${=name}`, already split, `"${name}"`/`"$name"` deliberately one word,
 * and `${name[@]}`, array expansion.
 */

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

// Assignment whose right side is a command substitution that plausibly
// builds a list: name=$( ... find/ls/grep -l/rg -l ... ) or any $( ) that
// pipes through `tr '\n' ' '`.
const LIST_ASSIGN_RE =
  // socket-lint: allow uncommented-regex -- broken down in the comment above.
  /(?:^|[\s;&|(])(?<name>[A-Za-z_]\w*)=\$\((?<rhs>[^)]*)\)/g

// A QUOTED assignment whose value is a space-joined literal list —
// name="a/b c/d", name="-a -b", name="$x $y". zsh passes the bare expansion
// as ONE argument exactly like the command-substitution case (the `git commit
// -o "$paths"` footgun: the whole string becomes a single pathspec).
const LITERAL_ASSIGN_RE =
  // socket-lint: allow uncommented-regex -- quoted assign; value in <val>.
  /(?:^|[\s;&|(])(?<name>[A-Za-z_]\w*)=(?<q>["'])(?<val>[^"']*)\k<q>/g

// A list-producing right side: newline-to-space flattening, or a
// file-enumerating command anywhere in the pipeline.
function looksLikeListRhs(rhs: string): boolean {
  return (
    /tr\s+(?:"\\n"|'\\n'|\\n)\s+/.test(rhs) ||
    /(?:^|[\s;&|(])(?:fd|find|ls)\s/.test(rhs) ||
    /(?:grep|rg)\s+(?:--files-with-matches|-\w*l)/.test(rhs)
  )
}

// A quoted value is a list-of-args, not prose: 2+ whitespace-separated
// tokens where at least one looks like a path (`/`), a flag (`-…`), a
// dotted filename, or another variable expansion. `msg="hello world"` is not
// flagged; `paths=".config/a .config/b"` is.
function looksLikeListLiteral(val: string): boolean {
  const tokens = val.trim().split(/\s+/)
  if (tokens.length < 2) {
    return false
  }
  return tokens.some(
    t =>
      t.includes('/') ||
      t.startsWith('-') ||
      /\.\w+$/.test(t) ||
      t.startsWith('$'),
  )
}

// A bare, unquoted `$name` expansion used as an argument after `from`.
// `${=name}`, forced split, quoted forms, and `${name[@]}` arrays are fine.
//
// Quote state is TRACKED rather than inferred from the single preceding
// character. `"file: $f"` has a space before the `$`, so a one-char lookbehind
// reads it as bare and blocks a command that was already correct — the
// expansion is quoted, passes as one argument deliberately, and is exactly what
// this guard should leave alone.
function bareUnquotedUseAfter(
  flat: string,
  from: number,
  name: string,
): boolean {
  const after = flat.slice(from)
  const token = `$${name}`
  let inSingle = false
  let inDouble = false
  for (let i = 0, { length } = after; i < length; i += 1) {
    const ch = after[i]!
    // Inside double quotes a backslash escapes the next character, so skip it
    // instead of letting a `\"` flip the quote state.
    if (ch === '\\' && inDouble) {
      i += 1
      continue
    }
    // A `'` inside "..." is literal, and a `"` inside '...' is literal.
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble || ch !== '$' || !after.startsWith(token, i)) {
      continue
    }
    // A trailing word char means a LONGER variable name; `}` means this was a
    // brace form the caller already treats as safe.
    const next = after[i + token.length]
    if (next !== undefined && (/\w/.test(next) || next === '}')) {
      continue
    }
    // `name=$x` is an assignment, `${name}` / `$#name` are brace or special
    // forms — none of them is a bare argument expansion.
    const prev = i > 0 ? after[i - 1] : undefined
    if (
      prev !== undefined &&
      (prev === '=' || prev === '{' || /\w/.test(prev))
    ) {
      continue
    }
    return true
  }
  return false
}

export function detectsUnsplitListVar(command: string): string | undefined {
  const flat = command.replace(/\\\n/g, ' ')
  for (const m of flat.matchAll(LIST_ASSIGN_RE)) {
    const name = m.groups!['name']!
    if (
      looksLikeListRhs(m.groups!['rhs']!) &&
      bareUnquotedUseAfter(flat, m.index + m[0].length, name)
    ) {
      return name
    }
  }
  for (const m of flat.matchAll(LITERAL_ASSIGN_RE)) {
    const name = m.groups!['name']!
    if (
      looksLikeListLiteral(m.groups!['val']!) &&
      bareUnquotedUseAfter(flat, m.index + m[0].length, name)
    ) {
      return name
    }
  }
  return undefined
}

export const hook = defineHook({
  bypass: ['zsh-word-split'],
  check: bashGuard(command => {
    const name = detectsUnsplitListVar(command)
    if (name === undefined) {
      return undefined
    }
    return block(
      [
        `[zsh-word-split-guard] \`$${name}\` holds a space-joined list but zsh will pass it as ONE argument.`,
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
  type: 'guard',
})

void runHook(hook, import.meta.url)
