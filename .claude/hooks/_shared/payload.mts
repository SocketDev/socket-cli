/**
 * @fileoverview Shared types for Claude Code PreToolUse hook payloads.
 *
 * Claude Code sends a JSON object on stdin to every PreToolUse hook:
 *
 *   { "tool_name": "Edit" | "Write" | "Bash" | ..., "tool_input": {...} }
 *
 * The shape of `tool_input` varies by tool. The fleet's hooks need
 * three subsets:
 *
 *   - Edit/Write hooks read `file_path` (always present) and either
 *     `content` (Write) or `new_string` (Edit).
 *   - Bash hooks read `command` (the shell line to run).
 *   - A few hooks (cross-repo-guard, no-fleet-fork-guard) read
 *     `file_path` to gate edits to specific paths.
 *
 * Each hook used to declare its own `tool_input` type inline — 7
 * distinct shapes existed across the fleet for the same data. This
 * file centralizes them so:
 *
 *   1. Future hooks copy-paste the right type instead of inventing one.
 *   2. A schema change (new tool, new field) is a one-file edit.
 *   3. The `unknown`-vs-`string` widening choice is consistent across
 *      hooks (we widen to `unknown` and narrow at use; that's the
 *      defensive shape for a payload we don't fully control).
 *
 * All fields are optional + `unknown` because:
 *   - Hooks never know which tool they're inspecting until they read
 *     `tool_name`. A Bash hook gets a Bash payload but the type is
 *     the same union shape.
 *   - The harness reserves the right to add fields; explicit `unknown`
 *     forces callers to narrow at use, which prevents silent breakage
 *     when an unexpected value lands in a known field.
 */

/**
 * The full PreToolUse payload Claude Code sends on stdin. Every hook
 * imports this and narrows the `tool_input` fields it reads.
 */
export interface ToolCallPayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: ToolInput | undefined
}

/**
 * Union of the `tool_input` fields the fleet's hooks read. Tool-
 * specific fields are all optional and typed `unknown` — narrow at
 * the use site so a payload-shape surprise (number where a string
 * expected, etc.) doesn't crash the hook.
 */
export interface ToolInput {
  // Edit/Write
  readonly file_path?: unknown
  readonly content?: unknown
  readonly new_string?: unknown
  readonly old_string?: unknown
  // Bash
  readonly command?: unknown
}

/**
 * Narrow `tool_input.command` to a string. Returns `undefined` when
 * the field is missing or non-string. Use as the canonical entry
 * point for Bash hooks so the narrowing logic is one line at every
 * call site:
 *
 *   const cmd = readCommand(payload)
 *   if (!cmd) return
 */
export function readCommand(payload: ToolCallPayload): string | undefined {
  const cmd = payload?.tool_input?.command
  return typeof cmd === 'string' ? cmd : undefined
}

/**
 * Narrow `tool_input.file_path` to a string. Same shape as
 * `readCommand` — single entry point so callers don't repeat the
 * `typeof === 'string'` guard.
 */
export function readFilePath(payload: ToolCallPayload): string | undefined {
  const fp = payload?.tool_input?.file_path
  return typeof fp === 'string' ? fp : undefined
}

/**
 * Narrow the write-content field. For Write tools the field is
 * `content`; for Edit it's `new_string`. Returns the first present
 * string field or `undefined`. Useful for hooks that want to scan
 * "what's about to land on disk" without caring whether it's a
 * Write or an Edit.
 */
export function readWriteContent(
  payload: ToolCallPayload,
): string | undefined {
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
