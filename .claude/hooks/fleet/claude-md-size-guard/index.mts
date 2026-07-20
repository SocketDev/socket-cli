/*
 * @file Claude Code PreToolUse hook — claude-md-size-guard.
 *
 * Blocks Edit/Write tool calls that would push CLAUDE.md above the
 * 40KB whole-file size cap. The cap measures the ENTIRE post-edit
 * file, not just the fleet-canonical block — fleet content + per-repo
 * content both count.
 *
 * Why a whole-file cap: every byte in CLAUDE.md is load-bearing
 * in-context tokens for every Claude session opened in the repo, AND
 * fleet content is duplicated across ~12 socket-* repos. The 40KB
 * ceiling forces ruthless reference-deferral: each rule states the
 * invariant + a one-line "Why" + a link to docs/agents.md/fleet/<topic>.md
 * for the full pattern catalog. Detail goes in the linked doc.
 *
 * What the hook does:
 *   1. Fires only on Edit/Write tool calls targeting a CLAUDE.md.
 *   2. Computes the post-edit text (Write: content; Edit: splice).
 *   3. If the whole file exceeds the cap, exits 2 with a stderr message
 *      naming the size, the cap, and the canonical remediation.
 *
 * Cap policy:
 *   - Default: 40 KB (40_960 bytes). Override per-repo via env
 *     `CLAUDE_MD_BYTES`. Legacy `CLAUDE_MD_FLEET_BLOCK_BYTES` is read
 *     as a fallback so existing per-repo overrides don't break.
 *
 * Hook contract:
 *   - Reads Claude Code's PreToolUse JSON from stdin.
 *   - Operates on `tool_input.new_string` (Edit) or `tool_input.content`
 *     (Write). When an Edit is a partial replacement we read the on-
 *     disk file and apply the diff in-memory. If we can't reliably
 *     compute (ambiguous Edit), we fail open.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const DEFAULT_CAP_BYTES = 40 * 1024

/**
 * Compute the post-edit text. For Write, that's just `content`. For Edit,
 * splice the on-disk file: replace `old_string` with `new_string` once. If the
 * on-disk file isn't readable or `old_string` doesn't match exactly, return
 * undefined (caller fails open).
 */
export function computePostEditText(
  toolName: string,
  filePath: string,
  newString: string | undefined,
  oldString: string | undefined,
  content: string | undefined,
): string | undefined {
  if (toolName === 'Write') {
    return content
  }
  if (toolName !== 'Edit') {
    return undefined
  }
  if (!existsSync(filePath)) {
    // First Edit on a new file is essentially a Write; treat
    // new_string as the full content.
    return newString
  }
  if (oldString === undefined || newString === undefined) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const idx = raw.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  return raw.slice(0, idx) + newString + raw.slice(idx + oldString.length)
}

export function buildBlockMessage(
  filePath: string,
  fileBytes: number,
  capBytes: number,
): string {
  const lines: string[] = []
  lines.push('[claude-md-size-guard] Blocked: CLAUDE.md too large.')
  lines.push(`  File:        ${filePath}`)
  lines.push(`  File size:   ${fileBytes} bytes`)
  lines.push(`  Cap:         ${capBytes} bytes (whole file)`)
  lines.push(`  Over by:     ${fileBytes - capBytes} bytes`)
  lines.push('')
  lines.push('  CLAUDE.md is load-bearing in-context for every session, and')
  lines.push('  the fleet block is duplicated across ~12 socket-* repos. The')
  lines.push('  40KB ceiling forces ruthless reference-deferral:')
  lines.push('')
  lines.push('    1. State the invariant + one-line "Why" inline.')
  lines.push('    2. Move detail to `docs/agents.md/fleet/<topic>.md`.')
  lines.push('    3. Link from the rule: `[Full details](docs/agents.md/...)`.')
  return lines.join('\n') + '\n'
}

export function getCap(): number {
  const env =
    process.env['CLAUDE_MD_BYTES'] ?? process.env['CLAUDE_MD_FLEET_BLOCK_BYTES']
  if (!env) {
    return DEFAULT_CAP_BYTES
  }
  const n = Number.parseInt(env, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_CAP_BYTES
  }
  return n
}

export function isClaudeMd(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  /* c8 ignore next */
  const base = normalizePath(filePath).split('/').pop() ?? ''
  return base === 'CLAUDE.md'
}

export const check = editGuard((filePath, content, payload) => {
  if (!isClaudeMd(filePath)) {
    return undefined
  }
  const toolName = payload.tool_name!
  // editGuard's `content` arg already resolves to `content` (Write) or
  // `new_string` (Edit). computePostEditText reads newString only on the
  // Edit branch and content only on the Write branch, so passing the same
  // resolved value to both slots is correct for each tool.
  const oldString = payload.tool_input?.old_string
  const postEdit = computePostEditText(
    toolName,
    filePath,
    content,
    typeof oldString === 'string' ? oldString : undefined,
    content,
  )
  if (postEdit === undefined) {
    // Fail open — couldn't compute post-edit text reliably.
    return undefined
  }
  const cap = getCap()
  const size = Buffer.byteLength(postEdit, 'utf8')
  if (size <= cap) {
    return undefined
  }
  return block(buildBlockMessage(filePath, size, cap))
})

export const hook = defineHook({
  bypass: ['claude-md-size'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
