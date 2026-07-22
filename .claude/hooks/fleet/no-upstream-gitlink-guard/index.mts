#!/usr/bin/env node
// Claude Code PreToolUse hook — no-upstream-gitlink-guard.
//
// BLOCKS any Bash git command that would STAGE a path under `upstream/` into the
// index — `git add upstream/…` (incl. `-f`), `git submodule add … upstream/…`,
// and `git update-index --add … upstream/…`. Upstream reference submodules are
// `.gitmodules`-only: the `ref = <40hex>` field is the pinned commit of record,
// so a tracked gitlink (a `160000` index entry) would be a redundant second copy
// of that same SHA. `upstream/` is always git-ignored and is never re-included
// with a `!` negation.
//
// `git update-index --force-remove upstream/…` (dropping a stray gitlink) and
// `git add .gitmodules` (the record itself) are the FIX, not the violation — the
// guard leaves both alone.
//
// Detection is shell-command tokenized (not a raw regex): the git subcommand is
// the first bare token; a path argument is "under upstream/" after normalizing
// separators + stripping a leading `./`. Fails open on parse errors — a guard
// bug must not wedge every Bash call.
//
// Convention: docs/agents.md/fleet/upstream-references.md.
// Bypass: `Allow upstream-gitlink bypass`.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

export const triggers: readonly string[] = ['upstream/']

export interface UpstreamGitlinkDetection {
  readonly command: string | undefined
  readonly detected: boolean
  readonly path: string | undefined
}

// True when a path arg is the `upstream/` tree itself or a child of it.
// `normalizePath` handles the separator-sensitive normalization (backslashes to
// forward slashes, `./` stripping, `..` collapse) before the prefix test.
function isUnderUpstream(arg: string): boolean {
  const p = normalizePath(arg)
  return p === 'upstream' || p.startsWith('upstream/')
}

export function detectUpstreamGitlinkStage(
  command: string,
): UpstreamGitlinkDetection {
  const gitCmds = commandsFor(command, 'git')
  for (const { args } of gitCmds) {
    // The bare (non-flag) tokens; the first is the git subcommand.
    const bare: string[] = []
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (!arg.startsWith('-')) {
        bare.push(arg)
      }
    }
    const sub = bare[0]
    // `git add <path…>` — force-add past the ignore is the vector we block.
    if (sub === 'add') {
      for (let i = 1, { length } = bare; i < length; i += 1) {
        if (isUnderUpstream(bare[i]!)) {
          return { command: 'git add', detected: true, path: bare[i]! }
        }
      }
    } else if (sub === 'submodule' && bare[1] === 'add') {
      // `git submodule add … <dest>` — the dest under upstream/ creates a gitlink.
      for (let i = 2, { length } = bare; i < length; i += 1) {
        if (isUnderUpstream(bare[i]!)) {
          return {
            command: 'git submodule add',
            detected: true,
            path: bare[i]!,
          }
        }
      }
    } else if (sub === 'update-index' && args.includes('--add')) {
      // `git update-index --add <path>` — the low-level add. `--force-remove`
      // has no `--add`, so dropping a gitlink stays allowed.
      for (let i = 1, { length } = bare; i < length; i += 1) {
        if (isUnderUpstream(bare[i]!)) {
          return {
            command: 'git update-index --add',
            detected: true,
            path: bare[i]!,
          }
        }
      }
    }
  }
  return { command: undefined, detected: false, path: undefined }
}

function formatBlock(detection: UpstreamGitlinkDetection): string {
  return (
    [
      `[no-upstream-gitlink-guard] Blocked: \`${detection.command}\` would stage \`${detection.path}\` under upstream/.`,
      '',
      '  Upstream reference submodules are `.gitmodules`-only: the `ref = <40hex>`',
      '  field is the pinned commit of record, so a tracked gitlink (a 160000 index',
      '  entry) is a redundant second copy of that SHA. `upstream/` is always',
      '  git-ignored and never re-included.',
      '',
      '  Fix: record the reference in `.gitmodules` (`gen-gitmodules-hash.mts --set`)',
      '  and materialize it with `git-partial-submodule.mts clone`; drop a stray',
      '  gitlink with `git update-index --force-remove <path>`. See',
      '  docs/agents.md/fleet/upstream-references.md.',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard((command, payload) => {
  const detection = detectUpstreamGitlinkStage(command)
  if (!detection.detected) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  return block(formatBlock(detection))
})

export const hook = defineHook({
  bypass: ['upstream-gitlink'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
