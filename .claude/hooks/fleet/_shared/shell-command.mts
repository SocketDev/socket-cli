/**
 * @file Shell-command parsing for Bash-allowlist hooks. Wraps `shell-quote` (a
 *   maintained, zero-dep JS tokenizer) so structure-sensitive guards can reason
 *   about "what binary actually runs, at each command position" instead of
 *   regex-matching the raw string. Why this exists: regex command detection is
 *   evaded by ordinary shell indirection — `g=git; $g push`, `eval "git push"`,
 *   `git $(printf push)`, `\git push`. CLAUDE.md ("Background Bash") mandates
 *   AST-based parsing for structure-sensitive Bash rules; this is the fleet's
 *   JS parser layer, built on `shell-quote` (the fleet-canonical shell parser).
 *   What it gives you:
 *
 *   - `parseCommands(command)` — split a command line into Command segments, one
 *     per shell command (separated by `;`, `&&`, `||`, `|`, `&`, and the
 *     boundaries of `$(…)` substitutions). Each segment carries its binary,
 *     args, leading `VAR=val` assignments, and indirection flags.
 *   - `findInvocation(command, { binary, subcommand })` — true when any segment
 *     invokes `binary` (optionally with `subcommand` as its first non-flag
 *     argument). Sees through chains, substitution, and quoting.
 *   - Each Command exposes `viaVariable` (binary resolved from `$VAR` →
 *     shell-quote yields an empty binary token) and `viaEval` (the binary is
 *     `eval`), so a guard can choose to BLOCK or fail-loud on indirection it
 *     can't statically resolve rather than silently allow it. Limitation:
 *     shell-quote tokenizes, it doesn't fully evaluate. It cannot expand a
 *     variable's value (`g=git; $g push` yields an empty binary, not `git`) —
 *     but it FLAGS that the binary was variable-sourced, which is the
 *     actionable signal. Aliases defined elsewhere and wrapper scripts remain
 *     out of scope for any static parser.
 */

// Use the fleet-canonical shell parser from @socketsecurity/lib-stable
// (built on shell-quote) instead of depending on the raw `shell-quote`
// package directly. lib-stable is already a declared dep of every hook,
// so this avoids a separate per-hook `shell-quote` dependency that
// package.json regeneration tends to drop, and `parseShell` is already
// typed as `ParseEntry[]` (no `as unknown` cast needed).
import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import type { ParseEntry } from '@socketsecurity/lib-stable/shell/parse'

// shell-quote emits operator objects ({ op }), comment objects ({ comment }),
// and bare strings. These ops separate one command from the next.
const COMMAND_SEPARATORS = new Set(['\n', '&', '&&', ';', '|', '||'])

export interface Command {
  /**
   * The resolved binary (first non-assignment token), or '' when it could not
   * be statically resolved (e.g. `$VAR` indirection).
   */
  readonly binary: string
  /**
   * Arguments after the binary, bare strings only (ops/comments dropped).
   */
  readonly args: readonly string[]
  /**
   * Leading `NAME=value` assignments that prefixed the command.
   */
  readonly assignments: readonly string[]
  /**
   * True when the binary token came from a variable (`$g push` → '').
   */
  readonly viaVariable: boolean
  /**
   * True when the binary is `eval` (the command it runs is opaque).
   */
  readonly viaEval: boolean
}

function isOp(e: ParseEntry): e is { op: string } {
  return typeof e === 'object' && e !== null && 'op' in e
}

function isComment(e: ParseEntry): e is { comment: string } {
  return typeof e === 'object' && e !== null && 'comment' in e
}

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Parse a shell command line into its constituent Command segments.
 *
 * Token handling:
 *
 * - Operators in COMMAND_SEPARATORS start a new segment.
 * - `$(…)` substitution shows up as `"$" ( … )`; the `(`/`)` ops bound an inner
 *   command, which becomes its own segment (so a substituted binary like `git
 *   $(printf push)` surfaces `printf` as a command too).
 * - Comments are dropped.
 * - A leading run of `NAME=value` tokens are assignments; the first
 *   non-assignment token is the binary.
 * - An empty-string binary token means the binary was `$VAR`-sourced.
 */
export function parseCommands(command: string): Command[] {
  let entries: ParseEntry[]
  try {
    entries = parseShell(command)
  } catch {
    return []
  }

  const commands: Command[] = []
  let tokens: string[] = []
  let sawVarPlaceholder = false

  const flush = () => {
    if (tokens.length === 0) {
      // A segment that was nothing but a `$VAR` placeholder still counts —
      // the binary was variable-sourced.
      if (sawVarPlaceholder) {
        commands.push({
          binary: '',
          args: [],
          assignments: [],
          viaVariable: true,
          viaEval: false,
        })
      }
      sawVarPlaceholder = false
      return
    }
    const assignments: string[] = []
    let i = 0
    while (i < tokens.length && ASSIGNMENT_RE.test(tokens[i]!)) {
      assignments.push(tokens[i]!)
      i += 1
    }
    const binary = i < tokens.length ? tokens[i]! : ''
    const args = tokens.slice(i + 1)
    commands.push({
      binary,
      args,
      assignments,
      // Empty binary after assignments means a `$VAR` placeholder collapsed
      // to '' sat in the binary slot.
      viaVariable: binary === '' && sawVarPlaceholder,
      viaEval: binary === 'eval',
    })
    tokens = []
    sawVarPlaceholder = false
  }

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (isComment(e)) {
      continue
    }
    if (isOp(e)) {
      if (COMMAND_SEPARATORS.has(e.op) || e.op === '(' || e.op === ')') {
        flush()
      }
      // Redirect ops (`>`, `>>`, `<`, etc.) and the `$` substitution sigil
      // are not separators; the redirect TARGET that follows is dropped by
      // not being a command token we care about. Simplest correct behavior:
      // treat a redirect op as ending the meaningful args (skip the rest of
      // this segment's tokens until a separator). We keep it lenient — args
      // after a redirect aren't binaries.
      continue
    }
    // Bare string token.
    if (e === '') {
      // shell-quote collapses `$VAR` / `${VAR}` to ''. Mark indirection;
      // hold a placeholder so an all-variable command still flushes.
      sawVarPlaceholder = true
      tokens.push('')
      continue
    }
    tokens.push(e)
  }
  flush()
  return commands
}

export interface InvocationQuery {
  /**
   * Binary name to match, e.g. 'git' or 'gh'. Case-sensitive.
   */
  readonly binary: string
  /**
   * Optional first non-flag argument, e.g. 'push' or 'workflow'.
   */
  readonly subcommand?: string | undefined
}

/**
 * True when `command` invokes `query.binary` (optionally with `subcommand` as
 * its first non-flag argument) in any of its command segments.
 *
 * "First non-flag argument" skips leading `-x` / `--long` / `-x value` option
 * tokens so `git -C /x push` matches `{ binary: 'git', subcommand: 'push' }`.
 * Flags that take a separate-word value (`-C <dir>`) are handled by skipping a
 * non-flag token that immediately follows a known value-taking flag is NOT
 * attempted — instead we scan for `subcommand` among the non-flag args, which
 * is robust for the subcommand-detection use case.
 */
export function findInvocation(
  command: string,
  query: InvocationQuery,
): boolean {
  // Cheap substring gate before the full tokenize. A command can only invoke
  // `query.binary` if the binary name appears verbatim somewhere in the line
  // (variable-sourced binaries collapse to '' and never match `binary` below,
  // so they can't be missed here). On the common PreToolUse path the keyword
  // is absent and we skip parseShell entirely.
  if (!command.includes(query.binary)) {
    return false
  }
  const commands = parseCommands(command)
  for (const cmd of commands) {
    if (cmd.binary !== query.binary) {
      continue
    }
    if (query.subcommand === undefined) {
      return true
    }
    // Scan ALL non-flag args for the subcommand verb. The first non-flag
    // token is NOT reliable: a global option's separate-word VALUE (e.g.
    // `/x` after `-C`, or `k=v` after `-c`) is itself non-flag and would
    // shadow the real subcommand. Scanning every non-flag arg is safe
    // because those VALUES are paths / kv strings, not subcommand verbs
    // like `push` / `workflow`, so a match on the verb is unambiguous.
    if (cmd.args.some(a => !a.startsWith('-') && a === query.subcommand)) {
      return true
    }
  }
  return false
}

/**
 * Every command segment that invokes `binary`. Use when a guard needs the
 * matched command's args (to check for a flag like `--write` or a subcommand)
 * rather than a yes/no. Returns [] when `binary` isn't invoked.
 *
 * This is the right entry point for "binary X with flag/arg Y" rules: a guard
 * reads `binary === 'codex'` segments and inspects their `args`, instead of
 * regex-matching `--write` anywhere in the raw command (which trips on the flag
 * appearing in a path, a sibling command, or a quoted string).
 */
export function commandsFor(command: string, binary: string): Command[] {
  // Cheap substring gate before the full tokenize. A segment can only have
  // `binary` as its resolved binary if the name appears verbatim in the line
  // (variable-sourced binaries collapse to '' and are filtered out below), so
  // a substring miss guarantees an empty result without parsing.
  if (!command.includes(binary)) {
    return []
  }
  return parseCommands(command).filter(c => c.binary === binary)
}

/**
 * Detect a `git add` invocation that sweeps the working tree (`-A` / `--all` /
 * `-u` / `--update` / `.`), returning a label like `git add -A` or undefined.
 * Parses with the shared tokenizer so chains, quoting, and leading env-var
 * assignments are handled, and a quoted "git add ." inside a message can't
 * false-fire. `git add ./path` (a surgical dotfile add) is not confused with
 * `git add .` because the parser preserves the exact arg. Shared by
 * overeager-staging-guard + parallel-agent-staging-guard.
 */
export function detectBroadGitAdd(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('add')) {
      continue
    }
    for (let k = 0, { length } = c.args; k < length; k += 1) {
      const arg = c.args[k]!
      if (
        arg === '--all' ||
        arg === '-A' ||
        arg === '--update' ||
        arg === '-u'
      ) {
        return `git add ${arg}`
      }
      if (arg === '.') {
        return 'git add .'
      }
    }
  }
  return undefined
}

/**
 * True when any `binary` segment carries one of `flags` as an argument. Matches
 * both the exact flag token (`--write`, `-w`) and the `--flag=value` form (so
 * `--write=true` counts for `--write`). Bundled short flags (`-wf`) are NOT
 * decomposed — list each short flag you care about.
 */
export function invocationHasFlag(
  command: string,
  binary: string,
  flags: readonly string[],
): boolean {
  const flagSet = new Set(flags)
  return commandsFor(command, binary).some(c =>
    c.args.some(a => {
      if (flagSet.has(a)) {
        return true
      }
      const eq = a.indexOf('=')
      return eq > 0 && flagSet.has(a.slice(0, eq))
    }),
  )
}

/**
 * True when the command uses indirection a static parser can't resolve to a
 * concrete binary: a `$VAR`-sourced binary or an `eval`. A guard that wants to
 * be strict (fail-closed on evasion attempts) can treat this as suspicious; a
 * guard that wants to stay permissive can ignore it.
 */
export function hasOpaqueInvocation(command: string): boolean {
  return parseCommands(command).some(c => c.viaVariable || c.viaEval)
}
