/**
 * @file Cross-CLI fleet-fork detection core. Non-Claude coding agents (Codex,
 *   Kimi) edit files through their own tools — Codex via an `apply_patch`
 *   envelope (a dedicated tool OR a `shell` heredoc), others via a direct
 *   file-path argument. This module turns any such tool call into the set of
 *   absolute paths it would write, then runs each through the Claude
 *   no-fleet-fork-guard `check` — the ONE decision engine for "is this a
 *   fleet-canonical fork?" So every CLI enforces the identical rule from a
 *   single source of truth; the per-CLI entrypoints only translate
 *   stdin/stdout.
 */

import path from 'node:path'

import { check } from '../../../.claude/hooks/fleet/no-fleet-fork-guard/index.mts'

// The apply_patch envelope names each touched file on its own header line. These
// are the four that carry a path (`*** Move to:` is the rename target). Kept in
// sorted order.
export const APPLY_PATCH_FILE_MARKERS: readonly string[] = [
  '*** Add File: ',
  '*** Delete File: ',
  '*** Move to: ',
  '*** Update File: ',
]

export interface BlockedTarget {
  readonly message: string
  readonly path: string
}

export interface ExtractEditedTargetsOptions {
  readonly cwd: string
  readonly toolInput: unknown
  readonly toolName?: string | undefined
}

export interface FindBlockedTargetOptions {
  readonly targets: readonly string[]
  readonly transcriptPath?: string | undefined
}

/**
 * Resolve the base directory apply_patch paths are relative to. A heredoc form
 * may lead with `cd <dir> && apply_patch <<'EOF'`, which re-bases the patch's
 * relative paths onto `<dir>`; without that prefix they are relative to `cwd`.
 */
export function applyPatchBaseDir(command: string, cwd: string): string {
  const match = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&]+))\s*&&/.exec(command)
  if (!match) {
    return cwd
  }
  const dir = match[1] ?? match[2] ?? match[3]!
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir)
}

/**
 * Gather every string field of a tool input that might carry a shell command or
 * an apply_patch body: `command` (string or argv array), plus the freeform
 * `content` / `input` / `patch` / `text` fields different tools use.
 */
export function collectCommandText(toolInput: unknown): string {
  if (typeof toolInput === 'string') {
    return toolInput
  }
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return ''
  }
  const obj = toolInput as Record<string, unknown>
  const parts: string[] = []
  const command = obj['command']
  if (typeof command === 'string') {
    parts.push(command)
  } else if (Array.isArray(command)) {
    for (let i = 0, { length } = command; i < length; i += 1) {
      const arg = command[i]
      if (typeof arg === 'string') {
        parts.push(arg)
      }
    }
  }
  const textKeys = ['content', 'input', 'patch', 'text']
  for (let i = 0, { length } = textKeys; i < length; i += 1) {
    const value = obj[textKeys[i]!]
    if (typeof value === 'string') {
      parts.push(value)
    }
  }
  return parts.join('\n')
}

/**
 * Pull every file path an apply_patch body would touch from its header lines.
 */
export function extractApplyPatchPaths(patchText: string): string[] {
  const paths: string[] = []
  const lines = patchText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trimEnd()
    for (
      let m = 0, { length: markerCount } = APPLY_PATCH_FILE_MARKERS;
      m < markerCount;
      m += 1
    ) {
      const marker = APPLY_PATCH_FILE_MARKERS[m]!
      if (line.startsWith(marker)) {
        const rest = line.slice(marker.length).trim()
        if (rest) {
          paths.push(rest)
        }
      }
    }
  }
  return paths
}

/**
 * Turn one tool call into the absolute paths it would write: direct file-path
 * arguments plus every path named in an apply_patch body found in its command /
 * freeform text. Deduplicated, resolved against `cwd`.
 */
export function extractEditedTargets(
  options: ExtractEditedTargetsOptions,
): string[] {
  const opts = { __proto__: null, ...options } as ExtractEditedTargetsOptions
  const { cwd, toolInput } = opts
  const targets = new Set<string>()
  if (toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    const obj = toolInput as Record<string, unknown>
    const directKeys = ['filePath', 'file_path', 'path']
    for (let i = 0, { length } = directKeys; i < length; i += 1) {
      const value = obj[directKeys[i]!]
      if (typeof value === 'string' && value) {
        targets.add(path.resolve(cwd, value))
      }
    }
  }
  const text = collectCommandText(toolInput)
  if (text.includes('*** ')) {
    const base = applyPatchBaseDir(text, cwd)
    const patchPaths = extractApplyPatchPaths(text)
    for (let i = 0, { length } = patchPaths; i < length; i += 1) {
      targets.add(path.resolve(base, patchPaths[i]!))
    }
  }
  return [...targets]
}

/**
 * Run each candidate path through the Claude no-fleet-fork-guard decision
 * engine, returning the first that would be blocked (with its message), or
 * `undefined` when all are allowed.
 */
export async function findBlockedTarget(
  options: FindBlockedTargetOptions,
): Promise<BlockedTarget | undefined> {
  const opts = { __proto__: null, ...options } as FindBlockedTargetOptions
  const { targets, transcriptPath } = opts
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const abs = targets[i]!
    const verdict = await check({
      tool_input: { file_path: abs },
      tool_name: 'Edit',
      transcript_path: transcriptPath,
    })
    if (verdict?.kind === 'block') {
      return {
        __proto__: null,
        message: verdict.message,
        path: abs,
      } as BlockedTarget
    }
  }
  return undefined
}
