/*
 * @file Shell-command parsing for Bash-allowlist hooks. Wraps `shell-quote` (a
 *   maintained, zero-dep JS tokenizer) so structure-sensitive guards can reason
 *   about "what binary actually runs, at each command position" instead of
 *   regex-matching the raw string. Why this exists: regex command detection is
 *   evaded by ordinary shell indirection — `g=git; $g push`, `eval "git push"`,
 *   `git $(printf push)`, `\git push`. CLAUDE.md ("Background Bash") mandates
 *   AST-based parsing for structure-sensitive Bash rules; this is the fleet's
 *   JS parser layer, built on `shell-quote`, the fleet-canonical shell parser.
 *   What it gives you:
 *
 *   - `parseCommands(command)` — split a command line into Command segments, one
 *     per shell command (separated by `;`, `&&`, `||`, `|`, `&`, and the
 *     boundaries of `$(…)` substitutions). Each segment carries its binary,
 *     args, leading `VAR=val` assignments, and indirection flags.
 *   - `findInvocation(command, { binary, subcommand })` — true when any segment
 *     invokes `binary` (optionally with `subcommand` as its first non-flag
 *     argument). Sees through chains, substitution, and quoting.
 *   - `$VAR` binaries resolve when the SAME command string carries the
 *     `VAR=value` assignment (`g=git; $g push` matches `{ binary: 'git' }`) —
 *     that indirection shape evaded every binary-matching guard before the
 *     resolution pass. Each Command still exposes `viaVariable` (the binary
 *     was `$VAR`-sourced and UNRESOLVABLE → empty binary token) and `viaEval`
 *     (the binary is `eval`), so a guard can BLOCK or fail-loud on
 *     indirection it can't statically resolve rather than silently allow it.
 *     Variables assigned outside the command string, aliases, and wrapper
 *     scripts remain out of scope for any static parser.
 */

// Use the fleet-canonical shell parser from @socketsecurity/lib-stable
// built on shell-quote, instead of depending on the raw `shell-quote`
// package directly. lib-stable is already a declared dep of every hook,
// so this avoids a separate per-hook `shell-quote` dependency that
// package.json regeneration tends to drop, and `parseShell` is already
// typed as `ParseEntry[]` (no `as unknown` cast needed).
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import type { ParseEntry } from '@socketsecurity/lib-stable/shell/parse'
import { resolveProjectDir } from './project-dir.mts'

// shell-quote emits operator objects ({ op }), comment objects ({ comment }),
// and bare strings. These ops separate one command from the next.
const COMMAND_SEPARATORS = new Set(['\n', ';', '&', '&&', '|', '||'])

// Redirect operators shell-quote emits as `{ op }`. The fd/target around them
// (`2>&1` → bare `'2'`, {op:'>&'}, bare `'1'`; `> /dev/null` → {op:'>'}, bare
// `'/dev/null'`) are NOT command args — they must not leak into the parsed arg
// list (a leaked `'2'`/`'1'`/`'/dev/null'` trips arg-shape guards). Excludes the
// `$` substitution sigil, handled as plain indirection, not a redirect.
const REDIRECT_OPS = new Set([
  '&>',
  '&>>',
  '<',
  '<&',
  '<<',
  '<<<',
  '<>',
  '>',
  '>&',
  '>>',
])

const FD_DIGIT_RE = /^\d+$/

export interface Command {
  /**
   * The resolved binary, first non-assignment token, or '' when it could not
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
   * True when the binary token came from a variable with no in-command
   * assignment to resolve it (`$g push` with `g` assigned elsewhere → '').
   * A variable the resolution pass expands is a plain binary, not this.
   */
  readonly viaVariable: boolean
  /**
   * True when the binary is `eval`, the command it runs is opaque.
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
 * Options each runner wrapper takes for ITSELF that consume a following value.
 * A `--flag=value` spelling carries its own value and is skipped as one token.
 */
const WRAPPER_VALUE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['command', new Set()],
  ['env', new Set(['--chdir', '--unset', '-C', '-u'])],
  ['ionice', new Set(['-c', '-n', '-p'])],
  ['nice', new Set(['--adjustment', '-n'])],
  ['nohup', new Set()],
  ['stdbuf', new Set(['--error', '--input', '--output', '-e', '-i', '-o'])],
  ['timeout', new Set(['--kill-after', '--signal', '-k', '-s'])],
])

/**
 * Index of the first arg past `binary`'s own options, or undefined when
 * `binary` is not a runner wrapper.
 */
function skipWrapperOwnArgs(
  binary: string,
  args: readonly string[],
): number | undefined {
  const valueFlags = WRAPPER_VALUE_FLAGS.get(binary)
  if (!valueFlags) {
    return undefined
  }
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg === '--') {
      i += 1
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      break
    }
    i += 1
    if (valueFlags.has(arg)) {
      i += 1
    }
  }
  // `env` also takes NAME=VALUE pairs before the command it runs.
  if (binary === 'env') {
    while (i < args.length && ASSIGNMENT_RE.test(args[i]!)) {
      i += 1
    }
  }
  // `timeout` takes a mandatory DURATION before the command it runs.
  if (binary === 'timeout' && i < args.length) {
    i += 1
  }
  return i
}

/**
 * Rewrite every command-separating newline as `;` so the tokenizer sees the
 * boundary.
 *
 * Shell-quote treats a raw newline as plain whitespace and emits no operator
 * for it, so `echo hi\ngit push` tokenizes as one command whose binary is
 * `echo` — and every command after the first line becomes invisible to a
 * binary-matching guard. Multi-line Bash is the common shape, so without this
 * a guard silently passes the thing it exists to block.
 *
 * A newline is content, not a separator, in three places, and each is left
 * exactly as it was: inside single or double quotes, directly after a
 * line-continuation backslash, and inside a heredoc body.
 */
export function normalizeNewlineSeparators(command: string): string {
  const out: string[] = []
  let quote: string | undefined
  let escaped = false
  let pendingHeredoc: string | undefined
  for (let i = 0, { length } = command; i < length; i += 1) {
    const ch = command[i]!
    if (escaped) {
      escaped = false
      if (ch === '\n') {
        // Line continuation — the shell joins the two lines, so drop the
        // backslash already emitted along with the newline.
        out.pop()
        continue
      }
      out.push(ch)
      continue
    }
    if (quote !== undefined) {
      if (ch === '\\' && quote !== "'") {
        escaped = true
      } else if (ch === quote) {
        quote = undefined
      }
      out.push(ch)
      continue
    }
    if (ch === '\\') {
      escaped = true
      out.push(ch)
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out.push(ch)
      continue
    }
    if (ch === '\n') {
      if (pendingHeredoc !== undefined) {
        // The body is data, never commands. Drop it whole — keeping it would
        // parse a `git push` inside a heredoc as a real invocation.
        const bodyEnd = skipHeredocBody(command, i + 1, pendingHeredoc)
        pendingHeredoc = undefined
        out.push(';')
        i = bodyEnd - 1
        continue
      }
      out.push(';')
      continue
    }
    if (ch === '<' && command[i + 1] === '<') {
      if (command[i + 2] === '<') {
        // `<<<` is a here-string: one line, no body. Consume it whole so the
        // trailing `<` pair is not re-read as a heredoc introducer.
        out.push('<<<')
        i += 2
        continue
      }
      const heredoc = readHeredocDelimiter(command, i)
      if (heredoc !== undefined) {
        pendingHeredoc = heredoc.delimiter
        out.push(command.slice(i, heredoc.end))
        i = heredoc.end - 1
        continue
      }
    }
    out.push(ch)
  }
  return out.join('')
}

/**
 * The index just past the heredoc terminator line that closes the body
 * starting at `lineStart`, or the end of the string when the body is
 * unterminated.
 */
function skipHeredocBody(
  command: string,
  lineStart: number,
  delimiter: string,
): number {
  let start = lineStart
  while (start < command.length) {
    let end = command.indexOf('\n', start)
    if (end === -1) {
      end = command.length
    }
    if (command.slice(start, end).trim() === delimiter) {
      return end === command.length ? command.length : end + 1
    }
    start = end + 1
  }
  return command.length
}

/**
 * The heredoc delimiter introduced at `start` (`<<EOF`, `<<-'EOF'`, `<< "EOF"`)
 * and the index just past it, or undefined when this is `<<<` (a here-string,
 * which has no body) or no delimiter follows.
 */
function readHeredocDelimiter(
  command: string,
  start: number,
): { delimiter: string; end: number } | undefined {
  let i = start + 2
  if (command[i] === '<') {
    // `<<<` is a here-string — one line, no body to protect.
    return undefined
  }
  if (command[i] === '-') {
    i += 1
  }
  while (command[i] === '\t' || command[i] === ' ') {
    i += 1
  }
  const quoteChar =
    command[i] === "'" || command[i] === '"' ? command[i]! : undefined
  if (quoteChar !== undefined) {
    const close = command.indexOf(quoteChar, i + 1)
    if (close === -1) {
      return undefined
    }
    return { delimiter: command.slice(i + 1, close), end: close + 1 }
  }
  let end = i
  while (end < command.length && /[A-Za-z0-9_]/.test(command[end]!)) {
    end += 1
  }
  return end === i ? undefined : { delimiter: command.slice(i, end), end }
}

/**
 * Simple `NAME=value` assignments anywhere in `command`, later wins. Feeds the
 * variable resolution in parseCommands so a binary held in a shell variable
 * (`OXFMT=oxfmt; "$OXFMT" -w f.mts`) resolves to its value instead of
 * collapsing to an opaque placeholder — an evasion a binary-matching guard
 * would otherwise never see. `export NAME=value` is covered too: the token
 * matches the same shape wherever it sits.
 */
function harvestAssignments(normalized: string): Map<string, string> {
  const assignments = new Map<string, string>()
  let entries: ParseEntry[]
  try {
    entries = parseShell(normalized)
  } catch {
    return assignments
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (typeof e !== 'string' || !ASSIGNMENT_RE.test(e)) {
      continue
    }
    const eq = e.indexOf('=')
    assignments.set(e.slice(0, eq), e.slice(eq + 1))
  }
  return assignments
}

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
 * - `$VAR` whose NAME=value assignment appears in the same command string
 *   resolves to that value (whole-string scope, later assignment wins), so the
 *   resolved binary is matched like a literal and is NOT indirection.
 * - An empty-string binary token means the binary was `$VAR`-sourced and
 *   unresolvable.
 */
export function parseCommands(command: string): Command[] {
  const normalized = normalizeNewlineSeparators(command)
  const assignments = harvestAssignments(normalized)
  let entries: ParseEntry[]
  try {
    entries = parseShell(normalized, name => assignments.get(name) ?? '')
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
    const leadingAssignments: string[] = []
    let i = 0
    while (i < tokens.length && ASSIGNMENT_RE.test(tokens[i]!)) {
      leadingAssignments.push(tokens[i]!)
      i += 1
    }
    const binary = i < tokens.length ? tokens[i]! : ''
    const args = tokens.slice(i + 1)
    commands.push({
      binary,
      args,
      assignments: leadingAssignments,
      // Empty binary after assignments means a `$VAR` placeholder collapsed
      // to '' sat in the binary slot.
      viaVariable: binary === '' && sawVarPlaceholder,
      viaEval: binary === 'eval',
    })
    // A runner wrapper (`timeout 5 git add -A`, `env FOO=1 pnpm build`) puts
    // the real command in its args. Record that command too, or every
    // binary-matching consumer sees only the wrapper and misses what it ran.
    // The wrapper entry stays, so a consumer looking for it still finds it.
    let outerBinary = binary
    let outerArgs: readonly string[] = args
    for (;;) {
      const start = skipWrapperOwnArgs(outerBinary, outerArgs)
      if (start === undefined || start >= outerArgs.length) {
        break
      }
      const innerBinary = outerArgs[start]!
      const innerArgs = outerArgs.slice(start + 1)
      commands.push({
        binary: innerBinary,
        args: innerArgs,
        assignments: [],
        viaVariable: false,
        viaEval: innerBinary === 'eval',
      })
      outerBinary = innerBinary
      outerArgs = innerArgs
    }
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
      } else if (REDIRECT_OPS.has(e.op)) {
        // A redirect is not a command arg. shell-quote emits the fd/target as
        // bare tokens AROUND the op (`2>&1` → `'2'`, {op:'>&'}, `'1'`; `> file`
        // → {op:'>'}, `'file'`). Drop a preceding bare fd digit, the source fd
        // and skip the operand entry that follows, target file or fd, so
        // neither leaks into args.
        if (tokens.length > 0 && FD_DIGIT_RE.test(tokens[tokens.length - 1]!)) {
          tokens.pop()
        }
        const next = entries[i + 1]
        if (next !== undefined && !isOp(next) && !isComment(next)) {
          i += 1
        }
      }
      // Other ops (the `$` substitution sigil) are plain indirection — ignore.
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
 * false-fire. `git add ./path`, a surgical dotfile add, is not confused with
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
        arg === '--update' ||
        arg === '-A' ||
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
 * Read a flag's value from a parsed segment's args, supporting the separate
 * (`--head v`, short `-H v`) and `=`-joined (`--head=v`) forms. Returns
 * undefined when the flag is absent or valueless (next token missing or
 * itself a flag) — reading from already-parsed args means a flag inside a
 * quoted string or heredoc body can never match.
 */
export function flagValue(
  args: readonly string[],
  long: string,
  short?: string | undefined,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === long || (short !== undefined && a === short)) {
      const next = args[i + 1]
      return next && !next.startsWith('-') ? next : undefined
    }
    if (a.startsWith(`${long}=`)) {
      return a.slice(long.length + 1)
    }
  }
  return undefined
}

/**
 * True when the command uses indirection a static parser can't resolve to a
 * concrete binary: a `$VAR`-sourced binary or an `eval`. A guard that wants to
 * be strict, fail-closed on evasion attempts, can treat this as suspicious; a
 * guard that wants to stay permissive can ignore it.
 */
export function hasOpaqueInvocation(command: string): boolean {
  return parseCommands(command).some(c => c.viaVariable || c.viaEval)
}

/**
 * True when `command` carries the fleet cascade sentinel — a real
 * `FLEET_SYNC=1` environment assignment on one of its segments
 * (`FLEET_SYNC=1 git commit …`, `env FLEET_SYNC=1 …`, `export FLEET_SYNC=1`).
 * The guards that exempt cascade commands share this ONE parser-backed check
 * so the sentinel's accepted spellings can't drift between hooks, and a
 * quoted "FLEET_SYNC=1" literal inside prose or another command's string
 * argument does NOT activate the exemption — the substring scans this
 * replaces harvested exactly that shape.
 */
export function isFleetSyncCommand(command: string): boolean {
  const sentinel = 'FLEET_SYNC=1'
  return parseCommands(command).some(
    c =>
      c.assignments.includes(sentinel) ||
      ((c.binary === 'env' || c.binary === 'export') &&
        c.args.includes(sentinel)),
  )
}

/**
 * Expand a leading `~` the way the shell would have BEFORE the hook saw the
 * string, then resolve against the hook's cwd. A raw `~/x` handed to
 * `existsSync` silently misses (`./~/x`), which flipped a downstream
 * transient-state probe into a false "missing .git" verdict.
 */
export function normalizeShellDir(
  dir: string,
  baseDir: string = resolveProjectDir(),
): string {
  const expanded =
    dir === '~'
      ? os.homedir()
      : dir.startsWith('~/')
        ? path.join(os.homedir(), dir.slice(2))
        : dir
  return path.resolve(baseDir, expanded)
}

/**
 * The directory a command effectively runs in. The fleet's cross-repo pattern
 * is `cd <abs-path> && <cmd>`, so a leading `cd` target wins; failing that a
 * `git -C <dir>` target; otherwise the session repo (`CLAUDE_PROJECT_DIR`).
 * Used by lint/tooling Bash guards (via `withBashGuard`'s `fleetOnly`) to skip
 * commands whose working directory is a non-fleet repo.
 */
export function commandWorkingDir(command: string): string {
  const cdDir = commandsFor(command, 'cd')[0]?.args[0]
  if (cdDir) {
    return normalizeShellDir(cdDir)
  }
  for (const git of commandsFor(command, 'git')) {
    const flagIdx = git.args.indexOf('-C')
    const target = flagIdx === -1 ? undefined : git.args[flagIdx + 1]
    if (target) {
      return normalizeShellDir(target)
    }
  }
  return process.env['CLAUDE_PROJECT_DIR'] ?? '.'
}
