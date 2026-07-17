/**
 * @file Uniform hook contract. A hook module exports a typed instance: export
 *   const hook = defineHook({ event: 'PreToolUse', // wires the hook (read at
 *   build time) type: 'guard', // 'guard' may block; 'nudge' only notifies
 *   matcher: ['Edit', 'Write', 'MultiEdit'], check: editGuard((path, content,
 *   payload) => block()/notify()/undefined), }) await runHook(hook,
 *   import.meta.url) // standalone entrypoint; no-op when imported The `check`
 *   RETURNS a verdict — `block(message)` (the runner prints it + sets exitCode
 *   2, or emits the Stop decision JSON), `notify(message)` (stderr, exit 0), or
 *   `undefined` (allow). A hook NEVER calls `process.exit` and runs no
 *   top-level logic beyond `runHook`, so many run in ONE dispatcher process
 *   (one node start, one lib import) instead of a process each — the fix for
 *   the per-tool-call hook tax. The metadata (`event` / `type` / `matcher` /
 *   `triggers`) is read at BUILD time by `make-hook-dispatch.mts`, which
 *   imports each hook and wires it by discovery — nothing is registered by
 *   hand, so a hook can never be silently left unwired. A unit test SPAWNS the
 *   hook (stdin payload) or calls `hook.invoke(payload)` directly. Enforced by
 *   the lint rule `socket/guard-contract` and scaffolded by the
 *   `creating-guards` skill. `runGuard(check)` / `bashGuard` / `editGuard`
 *   remain the lower-level verdict primitives `defineHook` builds on.
 */

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import v8 from 'node:v8'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  readCommand,
  readFilePath,
  readPayload,
  readWriteContent,
} from './payload.mts'
import type { ToolCallPayload } from './payload.mts'
import { isFleetManagedDir, isFleetManagedPath } from './fleet-repo.mts'
import { commandWorkingDir } from './shell-command.mts'

// Lazily resolved, NOT eagerly at module-eval. The shared logger graph
// (`@socketsecurity/lib`'s logger → primordials/globals) captures `SharedArray
// Buffer` and touches `node:console`/`node:tty` at construction — both are
// absent / snapshot-hostile in V8's `--build-snapshot` builder context, so a
// top-level `getDefaultLogger()` makes the hook-dispatch bundle un-snapshottable.
// The dispatcher's bundled `check` seam never reaches `applyGuardResult` (it
// surfaces verdicts itself), so deferring construction to first standalone use
// keeps standalone behavior byte-identical while letting the bundle snapshot.
let cachedLogger: ReturnType<typeof getDefaultLogger> | undefined
function logger(): ReturnType<typeof getDefaultLogger> {
  if (cachedLogger === undefined) {
    cachedLogger = getDefaultLogger()
  }
  return cachedLogger
}

/**
 * A block verdict — `message` is printed to stderr by the runner.
 */
export interface GuardBlock {
  readonly kind: 'block'
  readonly message: string
}

/**
 * A non-blocking notice — printed to stderr by the runner, but the tool call
 * proceeds (exit 0). The verdict a `-nudge` / `-nudge` returns.
 */
export interface GuardNotify {
  readonly kind: 'notify'
  readonly message: string
}

/**
 * A guard's verdict: block (exit 2), notify (stderr, exit 0), or `undefined`
 * (silent allow).
 */
export type GuardResult = GuardBlock | GuardNotify | undefined

/**
 * The uniform guard signature: payload in, verdict out.
 */
export type GuardCheck = (
  payload: ToolCallPayload,
) => GuardResult | Promise<GuardResult>

export interface GuardOptions {
  // Lint/tooling guards set this to skip a target in a non-fleet repo (that repo
  // runs its own toolchain). Security / git-state guards omit it.
  readonly fleetOnly?: boolean | undefined
}

/**
 * The Claude Code hook events a fleet hook binds to. The build-time dispatch
 * generator reads this off each hook instance to wire it to the right event —
 * nothing is registered by hand, so a hook can never be silently left unwired.
 */
export type HookEvent =
  | 'Notification'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PreToolUse'
  | 'SessionStart'
  | 'Stop'
  | 'SubagentStop'
  | 'UserPromptSubmit'

/**
 * A hook's kind. A `guard` may BLOCK (return `block()`); a `nudge` only
 * NOTIFIES (`notify()` / `undefined`). Enforced against the directory name:
 * `<name>-guard` is a guard, `<name>-nudge` is a nudge. Lets the generator
 * filter + order — guards before nudges, so a block early-exits before any
 * nudge runs.
 */
export type HookType = 'guard' | 'nudge'

/**
 * A PreToolUse / PostToolUse tool-name matcher ('Bash', 'Edit', 'mcp__.*', …).
 * Omit for Stop / SessionStart hooks — they have no tool to match.
 */
export type HookMatcher = string

/**
 * The declarative spec a hook module passes to `defineHook`. The metadata
 * (event, type, matcher, triggers) is read at BUILD time by the dispatch
 * generator; `check` is the runtime verdict function.
 */
export interface HookSpec {
  readonly check: GuardCheck
  readonly event: HookEvent
  readonly matcher?: HookMatcher | readonly HookMatcher[] | undefined
  // 'convention' marks a hook that encodes a FLEET convention (code style,
  // layout, tooling, prose shape) rather than a universal safety rule.
  // defineHook gates such a hook on the acted-on repo being fleet-managed
  // (root carries `.config/fleet/`), so it stands down in a foreign repo; a
  // foreign repo OPTS IN to the conventions by carrying that directory.
  // Safety / supply-chain / work-loss hooks omit this — they fire everywhere.
  readonly scope?: 'convention' | undefined
  // Pre-flight keywords: the dispatcher skips importing this hook unless one
  // appears in the raw payload. Omit for open-ended scanners (always run).
  readonly triggers?: readonly string[] | undefined
  readonly type: HookType
}

/**
 * A hook instance — declarative metadata plus the invoke mechanism. The
 * generator reads `.event` / `.type` / `.matcher` / `.triggers`; the dispatcher
 * (or a standalone entrypoint via `runHook`) calls `.invoke(payload)`.
 */
export interface Hook extends HookSpec {
  invoke(payload: ToolCallPayload): GuardResult | Promise<GuardResult>
}

/**
 * Construct a block verdict.
 */
export function block(message: string): GuardBlock {
  return { __proto__: null, kind: 'block', message } as GuardBlock
}

/**
 * Construct a non-blocking notice (a `-nudge` / `-nudge` verdict).
 */
export function notify(message: string): GuardNotify {
  return { __proto__: null, kind: 'notify', message } as GuardNotify
}

/**
 * Adapt a Bash-style check into the uniform contract: gate on
 * `tool_name === 'Bash'`, narrow `command` to a non-empty string, then defer to
 * `fn`. Returns `undefined` (allow) on a non-Bash tool or absent command.
 */
export function bashGuard(
  fn: (
    command: string,
    payload: ToolCallPayload,
  ) => GuardResult | Promise<GuardResult>,
  options?: GuardOptions | undefined,
): GuardCheck {
  const opts = { __proto__: null, ...options } as GuardOptions
  return async payload => {
    if (payload?.tool_name !== 'Bash') {
      return undefined
    }
    const command = readCommand(payload)
    if (!command) {
      return undefined
    }
    if (opts.fleetOnly && !isFleetManagedDir(commandWorkingDir(command))) {
      return undefined
    }
    return fn(command, payload)
  }
}

/**
 * Adapt an Edit/Write/MultiEdit-style check: gate on the edit tools, narrow
 * `file_path`, pass the about-to-land `content` (Write `content` / Edit
 * `new_string`, possibly undefined).
 */
export function editGuard(
  fn: (
    filePath: string,
    content: string | undefined,
    payload: ToolCallPayload,
  ) => GuardResult | Promise<GuardResult>,
  options?: GuardOptions | undefined,
): GuardCheck {
  const opts = { __proto__: null, ...options } as GuardOptions
  return async payload => {
    const tool = payload?.tool_name
    if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') {
      return undefined
    }
    const filePath = readFilePath(payload)
    if (!filePath) {
      return undefined
    }
    if (opts.fleetOnly && !isFleetManagedPath(filePath)) {
      return undefined
    }
    return fn(filePath, readWriteContent(payload), payload)
  }
}

/**
 * Apply a verdict: print the block message + set exitCode 2. Never UN-blocks —
 * in a shared dispatcher process a prior guard may have already set exitCode 2,
 * and a later allow must not clear it.
 */
let blockedThisProcess = false

// True once any guard in this (possibly shared dispatcher) process has blocked.
// The dispatcher reads it to early-exit — covering BOTH block protocols (a
// PreToolUse exitCode-2 block and a Stop stdout-JSON block, which leaves
// exitCode 0).
export function guardBlocked(): boolean {
  return blockedThisProcess
}

export function applyGuardResult(
  result: GuardResult,
  payload?: ToolCallPayload | undefined,
): void {
  if (!result) {
    return
  }
  if (result.kind === 'block') {
    blockedThisProcess = true
    // A Stop event (no tool_name) blocks via Claude Code's stdout JSON decision
    // protocol (exit 0, nothing on stderr). A PreToolUse / PostToolUse block
    // uses exitCode 2 + the reason on stderr.
    if (payload && payload.tool_name === undefined) {
      process.stdout.write(
        JSON.stringify({ decision: 'block', reason: result.message }),
      )
    } else {
      // exitCode is the load-bearing side effect — set it BEFORE the
      // best-effort stderr write. `runGuard`'s catch resets exitCode to 0 on
      // ANY throw (fail-open contract); a logger construction/write failure
      // must never cost the block itself by racing ahead of this line.
      process.exitCode = 2
      logger().error(result.message)
    }
    return
  }
  // notify: a non-blocking notice on stderr (exit 0), either event.
  logger().error(result.message)
}

/**
 * Standalone entrypoint, safe to call at a guard module's top level. Reads the
 * payload (shared cached/injected read when run under the dispatcher), runs
 * `check`, applies the verdict. Fails open on any error without un-blocking a
 * prior guard.
 */
export async function runGuard(
  check: GuardCheck,
  moduleUrl?: string | undefined,
): Promise<void> {
  // Run ONLY as the standalone entrypoint, or under the dispatcher (which
  // injects the payload via env). When a test imports the guard module, neither
  // holds — skip, or reading the test runner's never-closing stdin hangs the
  // import. Callers pass `import.meta.url`.
  if (!isGuardRunContext(moduleUrl)) {
    return
  }
  try {
    const payload = await readPayload()
    if (!payload) {
      return
    }
    applyGuardResult(await check(payload), payload)
  } catch (e) {
    // Fail-open stays fail-open in prod — a buggy hook must never wedge the
    // session. But a silent `catch {}` here means a genuine environment-
    // specific throw (a spawn quirk, a logger/tty failure) vanishes with no
    // trace, and downstream sees only "the guard exited 0" with nothing to
    // diagnose from. SOCKET_DEBUG opts into a stderr line carrying the real
    // error, without changing the fail-open decision.
    if (process.env['SOCKET_DEBUG']) {
      process.stderr.write(
        `[guard] runGuard caught (fail-open): ${errorMessage(e)}\n`,
      )
    }
    if (process.exitCode !== 2) {
      process.exitCode = 0
    }
  }
}

// The repo a payload acts on, judged fleet-managed or not: an edit tool's
// file_path wins, then a Bash command's effective working dir (honoring
// `cd <dir> &&` / `git -C`), then the payload/session cwd. Fail-safe toward
// enforcement (isFleetManagedDir/Path return true when undeterminable).
function payloadTargetIsFleetManaged(payload: ToolCallPayload): boolean {
  const input = payload?.tool_input
  const filePath =
    input && typeof input.file_path === 'string' ? input.file_path : undefined
  if (filePath) {
    return isFleetManagedPath(filePath)
  }
  const command =
    input && typeof input.command === 'string' ? input.command : undefined
  if (command) {
    return isFleetManagedDir(commandWorkingDir(command))
  }
  return isFleetManagedDir(payload?.cwd || process.cwd())
}

/**
 * Build a typed hook instance from its spec. Pure — safe to import, so the
 * build-time generator can read `.event` / `.type` / `.matcher` / `.triggers`
 * off it without running the hook.
 *
 * A `scope: 'convention'` spec gets its check wrapped so the hook stands down
 * when the acted-on repo is not fleet-managed (no `.config/fleet/` at its
 * root) — fleet conventions never bind a foreign repo unless it opts in by
 * carrying that directory. The module's own exported raw `check` is untouched,
 * so in-process tests still exercise the logic directly.
 */
export function defineHook(spec: HookSpec): Hook {
  const check: GuardCheck =
    spec.scope === 'convention'
      ? payload =>
          payloadTargetIsFleetManaged(payload) ? spec.check(payload) : undefined
      : spec.check
  return {
    __proto__: null,
    check,
    event: spec.event,
    invoke(payload: ToolCallPayload) {
      return check(payload)
    },
    matcher: spec.matcher,
    scope: spec.scope,
    triggers: spec.triggers,
    type: spec.type,
  } as Hook
}

/**
 * Standalone entrypoint for a hook instance — the `defineHook` analogue of
 * `runGuard`. Safe at a hook module's top level: invokes only under the
 * dispatcher or when this module is the process entrypoint.
 */
export async function runHook(
  hook: Hook,
  moduleUrl?: string | undefined,
): Promise<void> {
  return runGuard(hook.check, moduleUrl)
}

// True when the guard should actually read the payload + run: under the
// dispatcher (env set), or when this module IS the process entrypoint.
export function isGuardRunContext(moduleUrl: string | undefined): boolean {
  // A snapshot BUILD pass is never a run context. A bundled hook's `runHook`
  // sits in the snapshot bundle's top-level eval graph, and when
  // `node --build-snapshot <bundle.cjs>` is given an ABSOLUTE entry path,
  // `process.argv[1]` equals the bundle's `pathToFileURL(__filename).href` — so
  // the entrypoint test below would hold and `runGuard` would `await
  // readPayload()` on never-closing stdin during the build, hanging it. Gating
  // here keeps the snapshot build clean while preserving standalone + dispatcher
  // behavior. (See dispatch.mts's matching guard for the legacy-hook variant.)
  if (v8.startupSnapshot.isBuildingSnapshot()) {
    return false
  }
  if (typeof process.env['CLAUDE_HOOK_STDIN'] === 'string') {
    return true
  }
  const entry = process.argv[1]
  if (!moduleUrl || !entry) {
    return false
  }
  return moduleUrl === pathToFileURL(entry).href
}
