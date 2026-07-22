#!/usr/bin/env node
// Claude Code PreToolUse hook — no-upstream-edit-guard.
//
// BLOCKS any write to a path under `upstream/`. Upstream reference submodules are
// PRISTINE: the exact, pinned upstream bytes, kept read-only and referenced ONLY
// for lock-step porting into the fleet's own controlled copies (e.g.
// `.github/actions/fleet/*`) — we port what we need, nothing else, and never
// touch or directly link the reference. This guard is the enforcement:
//   - Edit / MultiEdit / Write with a `file_path` under `upstream/`.
//   - Bash writes whose TARGET is under `upstream/`: `sed -i … upstream/…`,
//     `tee upstream/…`, `rm … upstream/…`, `… > upstream/…` / `… >> upstream/…`,
//     and `cp`/`mv`/`ln` whose final destination arg is under `upstream/`.
// Reading FROM `upstream/` (the porting source) is always allowed. Refreshing a
// pin is `vendor-actions.mts` / `gen-gitmodules-hash.mts --set`, not a hand-edit.
//
// Detection normalizes separators before the prefix test and fails open on parse
// errors — a guard bug must not wedge Bash/edit calls.
//
// Convention: docs/agents.md/fleet/upstream-references.md.
// Bypass: `Allow upstream-edit bypass`.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import {
  bashGuard,
  block,
  defineHook,
  editGuard,
  runHook,
} from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import type { GuardResult, ToolCallPayload } from '../_shared/guard.mts'

export const triggers: readonly string[] = ['upstream/']

// Commands where EVERY bare operand is a write target (fanout / delete).
const WRITE_ALL_ARGS = new Set(['rm', 'tee'])
// Commands whose LAST bare operand is the destination (the rest are sources).
const WRITE_DEST_ARG = new Set(['cp', 'ln', 'mv'])

// True when a path arg resolves to the `upstream/` tree itself or a child.
export function isUnderUpstream(arg: string): boolean {
  const p = normalizePath(arg)
  return p === 'upstream' || p.startsWith('upstream/')
}

// sed edits in place with `-i`, `-i.bak` (suffix, no `=`), or `--in-place`.
function isSedInPlace(args: readonly string[]): boolean {
  return args.some(a => a === '-i' || a.startsWith('-i') || a === '--in-place')
}

/**
 * The first `upstream/` WRITE target in a Bash command, or undefined. Covers
 * `>`/`>>` redirects (the shell parser drops these, so match them directly),
 * `sed -i`, `tee`, `rm`, and `cp`/`mv`/`ln` destinations. Reads are ignored.
 */
export function detectUpstreamWrite(command: string): string | undefined {
  const redirects = command.match(/>>?\s*("?)([^\s"'|;&]+)\1/g) ?? []
  for (let i = 0, { length } = redirects; i < length; i += 1) {
    const target = redirects[i]!.replace(/^>>?\s*["']?/, '').replace(
      /["']$/,
      '',
    )
    if (isUnderUpstream(target)) {
      return target
    }
  }
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const cmd = commands[i]!
    const bare = cmd.args.filter(a => !a.startsWith('-'))
    if (cmd.binary === 'sed' && isSedInPlace(cmd.args)) {
      for (let j = 0, { length: blen } = bare; j < blen; j += 1) {
        if (isUnderUpstream(bare[j]!)) {
          return bare[j]!
        }
      }
    } else if (WRITE_ALL_ARGS.has(cmd.binary)) {
      for (let j = 0, { length: blen } = bare; j < blen; j += 1) {
        if (isUnderUpstream(bare[j]!)) {
          return bare[j]!
        }
      }
    } else if (WRITE_DEST_ARG.has(cmd.binary) && bare.length > 0) {
      const dest = bare[bare.length - 1]!
      if (isUnderUpstream(dest)) {
        return dest
      }
    }
  }
  return undefined
}

function formatBlock(target: string, how: string): string {
  return (
    [
      `[no-upstream-edit-guard] Blocked: ${how} would write \`${target}\` under upstream/.`,
      '',
      '  `upstream/` holds PRISTINE, read-only submodule references — the exact',
      '  pinned upstream bytes. We reference them for lock-step porting into the',
      "  fleet's own controlled copies (e.g. `.github/actions/fleet/*`); we never",
      '  touch or directly link the reference.',
      '',
      '  Fix: port what you need into a fleet-owned path instead. To refresh a',
      '  pin, run `node scripts/fleet/vendor-actions.mts` (or',
      '  `gen-gitmodules-hash.mts --set`), never a hand-edit. See',
      '  docs/agents.md/fleet/upstream-references.md.',
    ].join('\n') + '\n'
  )
}

const editCheck = editGuard((filePath, _content, payload) => {
  if (!isUnderUpstream(filePath) || !isFleetTarget(payload)) {
    return undefined
  }
  return block(formatBlock(filePath, `a ${String(payload.tool_name)} edit`))
})

const bashCheck = bashGuard((command, payload) => {
  const target = detectUpstreamWrite(command)
  if (!target || !isFleetTarget(payload)) {
    return undefined
  }
  return block(formatBlock(target, 'a shell write'))
})

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  return (await editCheck(payload)) ?? (await bashCheck(payload))
}

export const hook = defineHook({
  bypass: ['upstream-edit'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
