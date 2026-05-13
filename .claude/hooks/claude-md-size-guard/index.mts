#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-md-size-guard.
//
// Blocks Edit/Write tool calls that would push the CLAUDE.md
// fleet-canonical block above the 40KB size cap. The fleet block lives
// between `<!-- BEGIN FLEET-CANONICAL -->` and `<!-- END FLEET-CANONICAL -->`
// markers; everything outside is per-repo content owned by the host
// repo (different cap, evaluated separately).
//
// Why a fleet-block cap, not a whole-file cap: each fleet rule lands
// in EVERY socket-* repo as load-bearing in-context bytes. A rule
// added to the fleet block costs N copies of its size in working-set
// tokens. Per-repo content only costs once. The cap forces fleet
// additions to be terse + reference-deferred (defer details to
// `docs/references/<topic>.md`) so the canonical block stays load-bearing
// and the per-repo section keeps headroom.
//
// What the hook does:
//   1. Fires only on Edit/Write tool calls targeting a CLAUDE.md.
//   2. Extracts the post-edit fleet block (between markers) from the
//      proposed `new_string` / `content`.
//   3. If the proposed fleet block exceeds the cap, exits 2 with a
//      stderr message naming the size, the cap, and the canonical
//      remediation (move detail into `docs/references/<topic>.md`).
//
// Cap policy:
//   - Default: 40 KB (40_960 bytes). Override per-repo by setting
//     `CLAUDE_MD_FLEET_BLOCK_BYTES` in the env (rarely needed).
//   - Whole-file cap: NOT enforced here. Per-repo content can grow
//     freely; this hook only protects the fleet block.
//
// Hook contract:
//   - Reads Claude Code's PreToolUse JSON from stdin.
//   - Operates on `tool_input.new_string` (Edit) or `tool_input.content`
//     (Write). Edit doesn't always carry the whole file, so when the
//     edit is a partial replacement we ALSO read the on-disk file and
//     compute the post-edit size by applying the diff in-memory. If we
//     can't reliably compute (e.g. ambiguous Edit), we err on the side
//     of letting it through (fail-open, log a warning).
//   - Fails open on hook bugs (exit 0 + stderr log).

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

const DEFAULT_CAP_BYTES = 40 * 1024
const FLEET_BEGIN_MARKER = '<!-- BEGIN FLEET-CANONICAL'
const FLEET_END_MARKER = '<!-- END FLEET-CANONICAL'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
        old_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
}

function isClaudeMd(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const base = filePath.split('/').pop() ?? ''
  return base === 'CLAUDE.md'
}

function getCap(): number {
  const env = process.env['CLAUDE_MD_FLEET_BLOCK_BYTES']
  if (!env) {
    return DEFAULT_CAP_BYTES
  }
  const n = Number.parseInt(env, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_CAP_BYTES
  }
  return n
}

/**
 * Extract the fleet-canonical block from a CLAUDE.md text. Returns
 * undefined if the markers aren't present (per-repo CLAUDE.md may not
 * have them, in which case the cap doesn't apply).
 */
function extractFleetBlock(text: string): string | undefined {
  const beginIdx = text.indexOf(FLEET_BEGIN_MARKER)
  if (beginIdx === -1) {
    return undefined
  }
  const endIdx = text.indexOf(FLEET_END_MARKER, beginIdx)
  if (endIdx === -1) {
    return undefined
  }
  // Include both markers in the measured block.
  const blockEnd = text.indexOf('-->', endIdx)
  if (blockEnd === -1) {
    return undefined
  }
  return text.slice(beginIdx, blockEnd + 3)
}

/**
 * Compute the post-edit text. For Write, that's just `content`. For
 * Edit, splice the on-disk file: replace `old_string` with `new_string`
 * once. If the on-disk file isn't readable or `old_string` doesn't
 * match exactly, return undefined (caller fails open).
 */
function computePostEditText(
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
  // Single-replace splice (matches Edit tool semantics with
  // replace_all=false). If old_string isn't found, the Edit would
  // have failed before reaching us.
  const idx = raw.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  return raw.slice(0, idx) + newString + raw.slice(idx + oldString.length)
}

function emitBlock(
  filePath: string,
  blockBytes: number,
  capBytes: number,
): void {
  const lines: string[] = []
  lines.push('[claude-md-size-guard] Blocked: CLAUDE.md fleet block too large.')
  lines.push(`  File:        ${filePath}`)
  lines.push(`  Block size:  ${blockBytes} bytes`)
  lines.push(`  Cap:         ${capBytes} bytes`)
  lines.push(`  Over by:     ${blockBytes - capBytes} bytes`)
  lines.push('')
  lines.push(
    '  The fleet-canonical block (between `<!-- BEGIN FLEET-CANONICAL -->`',
  )
  lines.push(
    '  and `<!-- END FLEET-CANONICAL -->`) is byte-identical across all',
  )
  lines.push('  ~12 fleet repos. Every byte added there costs N copies of in-')
  lines.push('  context tokens. Per-repo content (outside the markers) has')
  lines.push('  no cap — keep new fleet rules terse and link to a reference')
  lines.push('  doc for the details:')
  lines.push('')
  lines.push('    1. Add a one-paragraph rule in the fleet block.')
  lines.push('    2. Move expanded explanation to')
  lines.push('       `docs/references/<topic>.md` (cascaded fleet-wide).')
  lines.push(
    '    3. Link from the rule: `[Full details](docs/references/...)`.',
  )
  lines.push('')
  lines.push('  See `docs/references/bypass-phrases.md` for an example of the')
  lines.push('  one-paragraph + reference shape.')
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!isClaudeMd(filePath)) {
    return
  }
  const postEdit = computePostEditText(
    payload.tool_name,
    filePath,
    payload.tool_input?.new_string,
    payload.tool_input?.old_string,
    payload.tool_input?.content,
  )
  if (postEdit === undefined) {
    // Fail open — couldn't compute post-edit text reliably.
    return
  }
  const fleetBlock = extractFleetBlock(postEdit)
  if (fleetBlock === undefined) {
    // No fleet markers in the file (per-repo CLAUDE.md without sync).
    // Cap doesn't apply.
    return
  }
  const cap = getCap()
  const size = Buffer.byteLength(fleetBlock, 'utf8')
  if (size <= cap) {
    return
  }
  emitBlock(filePath, size, cap)
  process.exitCode = 2
}

main().catch(e => {
  process.stderr.write(
    `[claude-md-size-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
