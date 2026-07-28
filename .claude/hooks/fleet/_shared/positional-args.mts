// Positional-argument extraction that survives VALUE-TAKING flags.
//
// The naive form — `args.filter(a => !a.startsWith('-'))` — is wrong for
// every CLI that has a flag consuming the next token: `gh --repo o/r pr
// create` yields `['o/r', 'pr', 'create']`, so a guard checking
// `words[0] === 'pr'` silently stops matching. That exact bug shipped in
// no-pr-in-squash-repo-guard and was caught only because a test covered
// flag placement; the same shape appears in a dozen other hooks.
//
// Code is law: the correct parse lives here once, with the value-flag
// tables, instead of being re-derived (and re-broken) per guard.

// Flags whose NEXT token is a value, per tool. Only the ones a guard is
// plausibly parsing around need listing — an unlisted value flag degrades
// to the naive behavior, which is what these guards already had.
export const GH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--assignee',
  '--base',
  '--body',
  '--body-file',
  '--head',
  '--label',
  '--repo',
  '--title',
  '-a',
  '-B',
  '-b',
  '-F',
  '-H',
  '-l',
  '-R',
  '-t',
])

export const NPM_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--access',
  '--otp',
  '--prefix',
  '--registry',
  '--tag',
  '--workspace',
  '-C',
  '-w',
])

export const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--git-dir',
  '--message',
  '--work-tree',
  '-C',
  '-c',
  '-m',
])

/**
 * Positional (non-flag) words from `argv`, skipping value-taking flags
 * AND the token each consumes.
 *
 * `limit` stops the scan early: a guard usually needs only the first one
 * or two words, and stopping keeps a later free-text value (a --body that
 * happens to read `pr create`) from being mistaken for a subcommand.
 * `--flag=value` needs no special case — it never consumes a next token.
 */
export function positionalArgs(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const words: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) {
      continue
    }
    // `--` ends option parsing; everything after is positional.
    if (arg === '--') {
      for (let j = i + 1; j < length && words.length < limit; j += 1) {
        const rest = argv[j]
        if (rest !== undefined) {
          words.push(rest)
        }
      }
      break
    }
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    words.push(arg)
    if (words.length >= limit) {
      break
    }
  }
  return words
}
