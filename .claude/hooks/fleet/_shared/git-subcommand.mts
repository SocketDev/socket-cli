/*
 * @file The ONE parse of `git`'s global-option grammar. Downstream of
 *   tokenization (`shell-command.mts` splits a Bash line into `Command`
 *   segments); this answers "which subcommand does this `git` segment run,
 *   and what args belong to it".
 *   Why it needs to exist: `git` accepts GLOBAL options before the
 *   subcommand, and several of them consume the FOLLOWING token as their
 *   value. A scan that stops at the first token not starting with `-` reads
 *   that VALUE as the subcommand, so `git -C /repo clone <url>` resolves to
 *   `/repo` and every subcommand-keyed guard silently stands down. That was a
 *   live bypass of `shallow-clone-guard` and of every destructive-shape check
 *   in `no-revert-guard` (`git -C /repo reset --hard origin/main`).
 *   The mirror-image failure is just as real: a value that LOOKS like a
 *   subcommand. `git -C clone fetch origin` runs `fetch` in a directory named
 *   `clone`, and a scan that hunts for the verb anywhere in the args reports
 *   `clone`. Skipping the value token fixes both directions at once.
 *   Both tables below are the git 2.50.1 `git --help` usage line, verified
 *   flag-by-flag by running each spelling and observing whether the next
 *   token was consumed. `gitUsageGlobalFlags` re-derives the usage line at test
 *   time so a future git that adds a global option fails a test instead of
 *   silently opening a bypass.
 *   Two deliberate divergences from the usage line, both verified:
 *
 *   - `--exec-path` is BOOLEAN here, not value-taking. The usage line spells it
 *     `--exec-path[=<path>]`, and bare `--exec-path` prints the exec path and
 *     exits WITHOUT running the subcommand. Listing it as value-taking would
 *     swallow a real subcommand token for no gain.
 *   - `--attr-source <tree>` IS value-taking but does not appear in the usage
 *     line at all (`git --attr-source HEAD rev-parse --git-dir` prints `.git`,
 *     so `HEAD` was consumed). The usage line is a floor, not the whole
 *     grammar.
 */

/**
 * A parsed command segment split at its subcommand: the verb, and the args
 * that follow it.
 */
export interface SubcommandSplit {
  /**
   * True when the scan crossed a leading option these tables do not know, so
   * `sub` may be that option's value rather than the real subcommand. A guard
   * whose miss is unrecoverable should widen to `gitSubcommandReadings`
   * instead of trusting `sub`.
   */
  readonly ambiguous: boolean
  /**
   * Args after the subcommand — the subcommand's own flags and operands.
   */
  readonly rest: readonly string[]
  /**
   * The subcommand verb, or undefined when the segment has none
   * (`git --version`).
   */
  readonly sub: string | undefined
}

const EMPTY_SPLIT: SubcommandSplit = {
  ambiguous: false,
  rest: [],
  sub: undefined,
}

/**
 * `git` global options that consume the NEXT token as their value. The
 * `=`-joined spellings (`--git-dir=/x`) need no entry — they are single
 * tokens that the flag branch skips. git accepts the separated form for every
 * long option here, which is the half a `--flag=value`-only parser misses.
 *
 * `--super-prefix` was removed in git 2.45 and errors out on a current git;
 * it stays listed so an older git on a contributor's machine cannot be used
 * to shift a guard's subcommand read.
 */
export const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--attr-source',
  '--config-env',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
  '-C',
  '-c',
])

/**
 * `git` global options that stand alone. Listed so an option NOT in either
 * table can be recognized as unknown and flagged `ambiguous` — the signal
 * that keeps a future git's new value-taking global from silently reopening
 * the `-C` bypass.
 */
export const GIT_GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  '--bare',
  '--exec-path',
  '--glob-pathspecs',
  '--help',
  '--html-path',
  '--icase-pathspecs',
  '--info-path',
  '--literal-pathspecs',
  '--man-path',
  '--no-advice',
  '--no-lazy-fetch',
  '--no-optional-locks',
  '--no-pager',
  '--no-replace-objects',
  '--noglob-pathspecs',
  '--paginate',
  '--version',
  '-h',
  '-P',
  '-p',
  '-v',
])

/**
 * Split a parsed segment's args at its subcommand, skipping every option that
 * consumes a following token along with that token. Generic over the flag
 * tables so a non-git binary with the same grammar shape (`pnpm --filter
 * <pkg> publish`) can share the one loop; omit `booleanFlags` when the caller
 * has no complete boolean table and therefore cannot judge ambiguity.
 */
export function splitSubcommandArgs(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
  booleanFlags?: ReadonlySet<string> | undefined,
): SubcommandSplit {
  let ambiguous = false
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      // An `=`-joined option is self-contained and can never swallow the
      // subcommand, so it never makes the read ambiguous.
      if (
        booleanFlags !== undefined &&
        !booleanFlags.has(arg) &&
        !arg.includes('=')
      ) {
        ambiguous = true
      }
      continue
    }
    return { ambiguous, rest: args.slice(i + 1), sub: arg }
  }
  return ambiguous ? { ambiguous, rest: [], sub: undefined } : EMPTY_SPLIT
}

/**
 * Split a `git` segment's args at its subcommand using git's own global-option
 * grammar.
 */
export function splitGitSubcommand(args: readonly string[]): SubcommandSplit {
  return splitSubcommandArgs(
    args,
    GIT_GLOBAL_VALUE_FLAGS,
    GIT_GLOBAL_BOOLEAN_FLAGS,
  )
}

/**
 * The subcommand verb of a parsed `git` segment, or undefined when it has
 * none. Use `splitGitSubcommand` when the subcommand's own args are needed
 * too, and `gitSubcommandReadings` when a missed match is unrecoverable.
 */
export function gitSubcommand(args: readonly string[]): string | undefined {
  return splitGitSubcommand(args).sub
}

/**
 * Every reading of a `git` segment a guard must consider, fail-closed.
 *
 * When the leading options are all recognized the confident split is the only
 * reading, so a precise guard sees no extra candidates and a directory named
 * `clone` or `push` cannot false-fire it. When the scan crossed an option
 * these tables do not know — a future git global, a typo, a truncated line —
 * the value it may have swallowed is unknowable, so EVERY bare token is
 * returned as a candidate subcommand paired with the args that follow it.
 *
 * Use this in a guard whose miss is unrecoverable (force-push, work-destroying
 * revert, an unbounded clone); use `gitSubcommand` where precision matters
 * more than the residual.
 */
export function gitSubcommandReadings(
  args: readonly string[],
): readonly SubcommandSplit[] {
  const split = splitGitSubcommand(args)
  if (!split.ambiguous) {
    return [split]
  }
  const readings: SubcommandSplit[] = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (!arg.startsWith('-')) {
      readings.push({ ambiguous: true, rest: args.slice(i + 1), sub: arg })
    }
  }
  return readings.length ? readings : [split]
}

/**
 * The value-taking and boolean global options a `git --help` usage line
 * advertises. Returns undefined when the text carries no parsable usage line,
 * so a caller can skip rather than fail on an output-format change.
 *
 * Exported for the drift test that pins the tables above to the installed
 * git: a new global option in a future release shows up as a table miss
 * instead of as a silent guard bypass.
 */
export function gitUsageGlobalFlags(helpText: string):
  | {
      readonly booleanFlags: readonly string[]
      readonly valueFlags: readonly string[]
    }
  | undefined {
  const start = helpText.indexOf('usage: git ')
  if (start === -1) {
    return undefined
  }
  const end = helpText.indexOf('<command>', start)
  if (end === -1) {
    return undefined
  }
  const usage = helpText.slice(start, end)
  const booleanFlags: string[] = []
  const valueFlags: string[] = []
  // Each option is a `-x` / `--long` token; it takes a value when a `<...>`
  // placeholder follows it, either `=<...>` (attached) or ` <...>` (separated).
  const optionRe = /(--?[A-Za-z][\w-]*)(\[?=?) ?(<[^>]+>)?/g
  let match = optionRe.exec(usage)
  while (match !== null) {
    const [, flag, joiner, placeholder] = match
    if (flag !== undefined) {
      if (placeholder !== undefined && !joiner?.startsWith('[')) {
        valueFlags.push(flag)
      } else {
        booleanFlags.push(flag)
      }
    }
    match = optionRe.exec(usage)
  }
  if (valueFlags.length === 0 && booleanFlags.length === 0) {
    return undefined
  }
  return { booleanFlags, valueFlags }
}
