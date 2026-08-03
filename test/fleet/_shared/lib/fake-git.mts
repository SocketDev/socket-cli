/**
 * @file An in-process `GitRunner` that answers canned output, so a test can
 *   drive git-shaped code with zero subprocesses. This is the fast path: pair
 *   it with the `GitRunner` seam in
 *   `.claude/hooks/fleet/_shared/git-runner.mts` and a suite that spent seconds
 *   forking git spends microseconds instead. Reach for the real fixtures in
 *   `./git-fixture.mts` only when the test is about git's own behavior. **An
 *   unmapped command throws. It never answers `''`.** That is the whole safety
 *   property of this module. A fake that hands back an empty string for a
 *   command nobody mapped recreates the exact failure this tooling exists to
 *   stamp out. Code under test reads "no output" as a real answer, takes the
 *   default branch, and the test passes green while asserting nothing. The same
 *   shape — a dead probe indistinguishable from empty output — has already made
 *   one fleet security guard fail open. A loud throw turns "you forgot to map
 *   this command" into a red test with the missing key printed, which is a
 *   thirty-second fix instead of a silent hole. The runner also records every
 *   call, so a converted test can prove it still drives the same code path it
 *   did when it was spawning for real. Asserting on `commandLines()` is what
 *   stops a refactor from quietly dropping a git call the test was supposed to
 *   cover.
 */

import type {
  GitRunner,
  GitRunnerOptions,
  GitRunResult,
} from '../../../../.claude/hooks/fleet/_shared/git-runner.mts'

/**
 * One recorded invocation of a fake runner.
 */
export interface FakeGitCall {
  args: readonly string[]
  cwd: string | undefined
}

/**
 * A full canned result. Any field left out takes its success default.
 */
export interface FakeGitResponse {
  /**
   * Exit status. Defaults to `0`. Use `null` to simulate a killed spawn.
   */
  status?: number | null | undefined
  /**
   * Defaults to `''`.
   */
  stdout?: string | undefined
  /**
   * Defaults to `''`.
   */
  stderr?: string | undefined
}

/**
 * Compute a reply from the call. Use this when one command must answer
 * differently on successive calls, or when the answer depends on `cwd`. It is
 * an escape hatch for dynamic output, NOT for unmapped commands — a handler is
 * still registered against an exact args key.
 */
export type FakeGitHandler = (call: FakeGitCall) => string | FakeGitResponse

/**
 * What a mapped command answers with. A bare string is its stdout.
 */
export type FakeGitReply = string | FakeGitResponse | FakeGitHandler

/**
 * How a command is named in a map. An array is exact, and is the form to use
 * when any argument contains whitespace. A string is split on whitespace as a
 * convenience, so `'rev-parse HEAD'` means `['rev-parse', 'HEAD']`.
 */
export type FakeGitKey = string | readonly string[]

/**
 * The command-to-reply map, as an object or as entry pairs.
 */
export type FakeGitEntries =
  | Readonly<Record<string, FakeGitReply>>
  | ReadonlyArray<readonly [FakeGitKey, FakeGitReply]>

/**
 * Options for {@link fakeGitRunner}.
 */
export interface FakeGitRunnerOptions {
  /**
   * Name used in the unmapped-command error, so a test wiring up several fakes
   * is told which one was missing an entry.
   */
  label?: string | undefined
}

/**
 * A `GitRunner` backed by canned output, plus its call log.
 */
export interface FakeGitRunner {
  (
    args: readonly string[],
    options?: GitRunnerOptions | undefined,
  ): GitRunResult
  /**
   * Every call in order, including the one that threw.
   */
  calls: FakeGitCall[]
  /**
   * How many calls were made, or how many matched `key`.
   */
  callCount: (key?: FakeGitKey | undefined) => number
  /**
   * Each recorded call as a space-joined command line, in order.
   */
  commandLines: () => string[]
  /**
   * Forget every recorded call. The map is untouched.
   */
  reset: () => void
  /**
   * True when `key` was called at least once.
   */
  wasCalledWith: (key: FakeGitKey) => boolean
}

/**
 * Thrown when the code under test runs a command the fake has no entry for.
 * Carries the arguments and the known keys so the fix is mechanical, and is a
 * named class so a test can assert the throw happened rather than matching on
 * message text.
 */
export class UnmappedGitCommandError extends Error {
  readonly args: readonly string[]
  readonly knownCommands: readonly string[]

  constructor(options: {
    args: readonly string[]
    cwd: string | undefined
    knownCommands: readonly string[]
    label: string
  }) {
    const { args, cwd, knownCommands, label } = options
    const known = knownCommands.length
      ? knownCommands.map(line => `           git ${line}`).join('\n')
      : '           (the map is empty)'
    super(
      `${label} was asked to run a command it has no entry for.\n` +
        `  Where: ${label}${cwd ? `, cwd ${cwd}` : ''}\n` +
        `  Saw:   git ${args.join(' ')}\n` +
        '  Wanted: an entry for that exact argument list.\n' +
        `  Fix:   add it to the map, e.g. \`[${args
          .map(arg => JSON.stringify(arg))
          .join(', ')}]: '<stdout>'\`. The fake throws rather than ` +
        "answering '' on purpose: an empty answer lets the caller read " +
        '"no output" as a real result, and the test then passes while ' +
        'asserting nothing.\n' +
        `  Known: \n${known}`,
    )
    this.args = args
    this.knownCommands = knownCommands
    this.name = 'UnmappedGitCommandError'
  }
}

/**
 * Normalize a command key to its canonical lookup string. A string key is split
 * on whitespace; an array key is taken exactly as given.
 */
export function fakeGitKeyOf(key: FakeGitKey): string {
  const args =
    typeof key === 'string' ? key.trim().split(/\s+/).filter(Boolean) : key
  return JSON.stringify(args)
}

/**
 * Turn a canonical lookup key back into a readable command line.
 */
export function fakeGitCommandLine(canonicalKey: string): string {
  const parsed: unknown = JSON.parse(canonicalKey)
  return Array.isArray(parsed) ? parsed.join(' ') : canonicalKey
}

/**
 * Read a map or entry-pair list into canonical-key form.
 */
export function fakeGitEntryMap(
  entries: FakeGitEntries,
): Map<string, FakeGitReply> {
  const map = new Map<string, FakeGitReply>()
  const pairs: ReadonlyArray<readonly [FakeGitKey, FakeGitReply]> =
    Array.isArray(entries)
      ? (entries as ReadonlyArray<readonly [FakeGitKey, FakeGitReply]>)
      : Object.entries(entries as Readonly<Record<string, FakeGitReply>>)
  for (let i = 0, { length } = pairs; i < length; i += 1) {
    const pair = pairs[i]!
    map.set(fakeGitKeyOf(pair[0]), pair[1])
  }
  return map
}

/**
 * Expand a reply into a full result, filling in the success defaults.
 */
export function fakeGitResultOf(reply: string | FakeGitResponse): GitRunResult {
  if (typeof reply === 'string') {
    return { status: 0, stderr: '', stdout: reply }
  }
  return {
    status: reply.status === undefined ? 0 : reply.status,
    stderr: reply.stderr ?? '',
    stdout: reply.stdout ?? '',
  }
}

/**
 * Build a `GitRunner` that answers `entries` and throws
 * {@link UnmappedGitCommandError} on anything else.
 *
 * @example
 *   const git = fakeGitRunner({
 *     'rev-parse --abbrev-ref HEAD': 'main',
 *     'status --porcelain': '',
 *     'rev-parse --verify nope': {
 *       status: 128,
 *       stderr: 'fatal: bad revision',
 *     },
 *   })
 *   const branch = currentBranch(git)
 *   assert.deepEqual(git.commandLines(), ['rev-parse --abbrev-ref HEAD'])
 */
export function fakeGitRunner(
  entries: FakeGitEntries,
  options: FakeGitRunnerOptions = {},
): FakeGitRunner {
  const label = options.label ?? 'fakeGitRunner'
  const replies = fakeGitEntryMap(entries)
  const calls: FakeGitCall[] = []

  function runFake(
    args: readonly string[],
    runOptions?: GitRunnerOptions | undefined,
  ): GitRunResult {
    const cwd = runOptions?.cwd
    const call: FakeGitCall = { args: [...args], cwd }
    // Record before the throw so a test that catches it can still inspect the
    // call it was missing an entry for.
    calls.push(call)
    const reply = replies.get(fakeGitKeyOf(args))
    if (reply === undefined) {
      throw new UnmappedGitCommandError({
        args: call.args,
        cwd,
        knownCommands: [...replies.keys()].map(fakeGitCommandLine),
        label,
      })
    }
    return fakeGitResultOf(typeof reply === 'function' ? reply(call) : reply)
  }

  function matches(key: FakeGitKey): FakeGitCall[] {
    const canonical = fakeGitKeyOf(key)
    return calls.filter(call => fakeGitKeyOf(call.args) === canonical)
  }

  function callCount(key?: FakeGitKey | undefined): number {
    return key === undefined ? calls.length : matches(key).length
  }

  function commandLines(): string[] {
    return calls.map(call => call.args.join(' '))
  }

  function reset(): void {
    calls.length = 0
  }

  function wasCalledWith(key: FakeGitKey): boolean {
    return matches(key).length > 0
  }

  return Object.assign(runFake, {
    callCount,
    calls,
    commandLines,
    reset,
    wasCalledWith,
  })
}

/**
 * Narrow a {@link FakeGitRunner} to the plain seam type. Handy when passing one
 * into a function that takes a `GitRunner` and the extra members would widen an
 * inferred type.
 */
export function asGitRunner(fake: FakeGitRunner): GitRunner {
  return fake
}
