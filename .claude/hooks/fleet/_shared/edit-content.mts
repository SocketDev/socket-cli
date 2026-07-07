/*
 * @file Materialize the full post-edit file content for an Edit/Write tool
 *   call. `editGuard` hands a guard the about-to-land `content` — the Write
 *   `content`, or for an Edit only the `new_string` FRAGMENT. A guard that must
 *   reason about the WHOLE file (e.g. "is this test file git-isolated?", "does
 *   the doc still carry its marker?") can't decide from a fragment: the signal
 *   it needs may live elsewhere in the file. This materializer returns the
 *   on-disk file with the edit applied so such guards see the real post-edit
 *   state instead of false-positiving on an append.
 */

import { existsSync, readFileSync } from 'node:fs'

import type { ToolCallPayload } from './payload.mts'

// Apply an Edit's `old_string` → `new_string` substitution against the on-disk
// file. Returns undefined when the file is unreadable, the inputs are missing,
// or `old_string` is absent / ambiguous (occurs more than once) — the caller
// then falls back to the fragment.
export function applyEditToFile(
  filePath: string,
  oldString: string | undefined,
  newString: string | undefined,
): string | undefined {
  if (
    !existsSync(filePath) ||
    oldString === undefined ||
    newString === undefined
  ) {
    return undefined
  }
  let onDisk: string
  try {
    onDisk = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const idx = onDisk.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  // Ambiguous match → don't guess which occurrence the Edit targets.
  if (onDisk.indexOf(oldString, idx + 1) !== -1) {
    return undefined
  }
  return onDisk.slice(0, idx) + newString + onDisk.slice(idx + oldString.length)
}

// Full post-edit content: Write → `content`; Edit → on-disk with the diff
// applied, falling back to the `new_string` (partial coverage) when the file
// can't be read or the match is ambiguous. Undefined only when nothing usable.
export function materializePostEditContent(
  filePath: string,
  content: string | undefined,
  payload: ToolCallPayload,
): string | undefined {
  if (payload?.tool_name === 'Write') {
    return content
  }
  const input = payload?.tool_input
  const oldString =
    typeof input?.old_string === 'string' ? input.old_string : undefined
  const newString =
    typeof input?.new_string === 'string' ? input.new_string : content
  const applied = applyEditToFile(filePath, oldString, newString)
  return applied ?? newString ?? content
}
