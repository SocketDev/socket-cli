/*
 * @file Shared types for Claude Code PreToolUse hook payloads. Claude Code
 *   sends a JSON object on stdin to every PreToolUse hook: { "tool_name":
 *   "Edit" | "Write" | "Bash" | ..., "tool_input": {...} } The shape of
 *   `tool_input` varies by tool. The fleet's hooks need three subsets:
 *
 *   - Edit/Write hooks read `file_path` (always present) and either `content`
 *     (Write) or `new_string` (Edit).
 *   - Bash hooks read `command` (the shell line to run).
 *   - A few hooks (cross-repo-guard, no-fleet-fork-guard) read `file_path` to
 *     gate edits to specific paths. Each hook used to declare its own
 *     `tool_input` type inline — 7 distinct shapes existed across the fleet for
 *     the same data. This file centralizes them so:
 *
 *   1. Future hooks copy-paste the right type instead of inventing one.
 *   2. A schema change (new tool, new field) is a one-file edit.
 *   3. The `unknown`-vs-`string` widening choice is consistent across hooks (we
 *      widen to `unknown` and narrow at use; that's the defensive shape for a
 *      payload we don't fully control). All fields are optional + `unknown`
 *      because:
 *
 *   - Hooks never know which tool they're inspecting until they read `tool_name`.
 *     A Bash hook gets a Bash payload but the type is the same union shape.
 *   - The harness reserves the right to add fields; explicit `unknown` forces
 *     callers to narrow at use, which prevents silent breakage when an
 *     unexpected value lands in a known field.
 */

import process from 'node:process'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { isFleetManagedDir, isFleetManagedPath } from './fleet-repo.mts'
import { commandWorkingDir } from './shell-command.mts'
import { readStdin } from './transcript.mts'

/**
 * The full PreToolUse payload Claude Code sends on stdin. Every hook imports
 * this and narrows the `tool_input` fields it reads.
 */
export interface ToolCallPayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: ToolInput | undefined
  // Present on every PreToolUse payload; hooks read it for bypass-phrase
  // checks (bypassPhrasePresent). Optional + string so a shape surprise
  // doesn't crash the narrow.
  readonly transcript_path?: string | undefined
  // The working directory Claude Code ran the tool from. Hooks that shell
  // out to git (commit-author-guard, etc.) read it to scope the spawn.
  // Optional + string so a shape surprise doesn't crash the narrow.
  readonly cwd?: string | undefined
}

/**
 * Union of the `tool_input` fields the fleet's hooks read. Tool- specific
 * fields are all optional and typed `unknown` — narrow at the use site so a
 * payload-shape surprise (number where a string expected, etc.) doesn't crash
 * the hook.
 */
export interface ToolInput {
  // Edit/Write
  readonly file_path?: unknown | undefined
  readonly content?: unknown | undefined
  readonly new_string?: unknown | undefined
  readonly old_string?: unknown | undefined
  // MultiEdit: an array of { old_string, new_string } edits applied in order.
  readonly edits?: unknown | undefined
  // Bash
  readonly command?: unknown | undefined
  // Bash: true when the call requested `run_in_background`. Hooks that gate
  // backgrounding (a backgrounded git commit hides its bounded pre-commit's
  // completion) read it. Optional + unknown so a shape surprise can't crash.
  readonly run_in_background?: unknown | undefined
}

/**
 * Narrow `tool_input.command` to a string. Returns `undefined` when the field
 * is missing or non-string. Use as the canonical entry point for Bash hooks so
 * the narrowing logic is one line at every call site:
 *
 * Const cmd = readCommand(payload) if (!cmd) return.
 */
export function readCommand(payload: ToolCallPayload): string | undefined {
  const cmd = payload?.tool_input?.command
  return typeof cmd === 'string' ? cmd : undefined
}

/**
 * Narrow `tool_input.file_path` to a string. Same shape as `readCommand` —
 * single entry point so callers don't repeat the `typeof === 'string'` guard.
 */
export function readFilePath(payload: ToolCallPayload): string | undefined {
  const fp = payload?.tool_input?.file_path
  return typeof fp === 'string' ? fp : undefined
}

/**
 * Narrow the write-content field. For Write tools the field is `content`; for
 * Edit it's `new_string`. Returns the first present string field or
 * `undefined`. Useful for hooks that want to scan "what's about to land on
 * disk" without caring whether it's a Write or an Edit.
 */
export function readWriteContent(payload: ToolCallPayload): string | undefined {
  const content = payload?.tool_input?.content
  if (typeof content === 'string') {
    return content
  }
  const newStr = payload?.tool_input?.new_string
  if (typeof newStr === 'string') {
    return newStr
  }
  return undefined
}

/**
 * Resolve the full text a file WILL have after the about-to-run edit, so a
 * guard can scan the post-edit document — not just the `new_string` fragment.
 *
 * - Write → `content` verbatim.
 * - Edit → the on-disk file with `old_string` replaced by `new_string` (first
 *   occurrence, matching the Edit tool). `undefined` if the file is unreadable
 *   or `old_string` isn't present (the edit wouldn't apply).
 * - MultiEdit → the on-disk file with each `{ old_string, new_string }` folded in
 *   order; `undefined` if any step's `old_string` is absent.
 *
 * `undefined` means "can't determine the post-edit text" → the caller fails
 * open. Replaces the per-hook `currentText.replace(old, new)` idiom (which had
 * drifted between `indexOf`+`slice` and `String.replace`, with differing
 * miss-handling).
 */
export function resolveEditedText(
  payload: ToolCallPayload,
): string | undefined {
  const input = payload?.tool_input
  if (!input) {
    return undefined
  }
  if (typeof input.content === 'string') {
    return input.content
  }
  const filePath = readFilePath(payload)
  if (!filePath) {
    return undefined
  }
  const current = safeReadFileSync(filePath)
  if (typeof current !== 'string') {
    return undefined
  }
  const { edits } = input
  if (Array.isArray(edits)) {
    let text = current
    for (let i = 0, { length } = edits; i < length; i += 1) {
      const edit = edits[i]
      if (!edit || typeof edit !== 'object') {
        continue
      }
      const oldStr = (edit as { old_string?: unknown | undefined }).old_string
      const newStr = (edit as { new_string?: unknown | undefined }).new_string
      if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
        continue
      }
      if (!text.includes(oldStr)) {
        return undefined
      }
      text = text.replace(oldStr, newStr)
    }
    return text
  }
  const oldStr = input.old_string
  const newStr = input.new_string
  if (typeof oldStr === 'string' && typeof newStr === 'string') {
    if (!current.includes(oldStr)) {
      return undefined
    }
    return current.replace(oldStr, newStr)
  }
  return undefined
}

/**
 * Read + parse the PreToolUse payload from stdin, failing open on any problem
 * (empty stdin, unreadable, malformed JSON) by returning undefined. The shared
 * preamble every guard repeats; the caller decides what "fail open" means
 * (typically `process.exit(0)`).
 */
export async function readPayload(): Promise<ToolCallPayload | undefined> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    return undefined
  }
  if (!raw) {
    return undefined
  }
  try {
    return JSON.parse(raw) as ToolCallPayload
  } catch {
    return undefined
  }
}

/**
 * Bash-guard harness: drain + parse stdin, gate on `tool_name === 'Bash'`,
 * narrow `command` to a non-empty string, then run `fn(command, payload)`.
 * Fails open on missing/unreadable/malformed payload, a non-Bash tool, an
 * absent command, or ANY throw from `fn` — a guard must never crash the tool
 * call it inspects. To BLOCK, `fn` sets `process.exitCode = 2` and returns; the
 * harness leaves that code intact. It fails open by simply not setting a code
 * (the process then exits 0), and resets the code on a thrown error so a
 * mid-`fn` throw can't half-block.
 */
export async function withBashGuard(
  fn: (command: string, payload: ToolCallPayload) => void | Promise<void>,
  options?: { fleetOnly?: boolean | undefined } | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    fleetOnly?: boolean | undefined
  }
  try {
    const payload = await readPayload()
    if (!payload || payload.tool_name !== 'Bash') {
      return
    }
    const command = readCommand(payload)
    if (!command) {
      return
    }
    // Lint/tooling guards pass `fleetOnly` so they skip a command whose working
    // directory is a non-fleet repo (a `cd <non-fleet> && …` cross-repo run):
    // that repo has its own toolchain and the fleet convention (vitest over
    // node --test, no `pnpm exec`, …) doesn't apply. Security / git-state
    // guards omit it and keep firing everywhere.
    if (opts.fleetOnly && !isFleetManagedDir(commandWorkingDir(command))) {
      return
    }
    await fn(command, payload)
  } catch {
    // Fail open — but never UN-block: in a shared dispatcher process a prior
    // guard may have set exitCode 2; a later guard's fail-open must not clear it.
    if (process.exitCode !== 2) {
      process.exitCode = 0
    }
  }
}

/**
 * Edit/Write-guard harness: drain + parse stdin, gate on `tool_name` being
 * `Edit` / `Write` / `MultiEdit`, narrow `file_path` to a non-empty string,
 * then run `fn(filePath, content, payload)` where `content` is the
 * about-to-land text (Write `content` or Edit `new_string`, possibly
 * undefined). Same fail-open contract as `withBashGuard`: `fn` blocks by
 * setting `process.exitCode = 2` and returning.
 */
export async function withEditGuard(
  fn: (
    filePath: string,
    content: string | undefined,
    payload: ToolCallPayload,
  ) => void | Promise<void>,
  options?: { fleetOnly?: boolean | undefined } | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as {
    fleetOnly?: boolean | undefined
  }
  try {
    const payload = await readPayload()
    const tool = payload?.tool_name
    if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') {
      return
    }
    const filePath = readFilePath(payload!)
    if (!filePath) {
      return
    }
    // Lint-parity guards pass `fleetOnly` so they skip files in a non-fleet
    // repo: those repos run their own toolchain and aren't fleet-linted, so a
    // fleet convention (logger over console, function declarations, …) doesn't
    // apply and must not demand a `socket-lint` opt-out in their code. Security
    // / git-state guards omit it and keep firing everywhere.
    if (opts.fleetOnly && !isFleetManagedPath(filePath)) {
      return
    }
    await fn(filePath, readWriteContent(payload!), payload!)
  } catch {
    // Fail open — but never UN-block: in a shared dispatcher process a prior
    // guard may have set exitCode 2; a later guard's fail-open must not clear it.
    if (process.exitCode !== 2) {
      process.exitCode = 0
    }
  }
}
