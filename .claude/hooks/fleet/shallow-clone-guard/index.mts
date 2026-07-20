#!/usr/bin/env node
// Claude Code PreToolUse hook — shallow-clone-guard.
//
// BLOCKS any Bash `git clone …` that lacks BOTH `--depth=1` (or `--depth 1`)
// AND `--single-branch`. A bare `git clone <url>` fetches the full object
// graph for every branch — unnecessary for review work, slow, and a larger
// attack surface than a bounded shallow clone.
//
// `git clone --help` and `git clone -h` are information queries that download
// nothing and are always allowed.
//
// Detection (shell-command tokenized, not a raw regex): the command invokes
// `git` with `clone` as its first bare argument; `--help`/`-h` exempt it;
// hasDepth1 is true when `--depth=1` appears OR `--depth` is followed by `1`
// as a separate token; hasSingleBranch is true when `--single-branch` appears.
// The guard fires when either flag is missing.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

export const triggers: readonly string[] = ['clone']

export interface ShallowCloneDetection {
  readonly detected: boolean
  readonly hasDepth1: boolean
  readonly hasSingleBranch: boolean
}

export function detectShallowClone(command: string): ShallowCloneDetection {
  const gitCmds = commandsFor(command, 'git')
  for (const { args } of gitCmds) {
    // Find the first bare token — it must be `clone`.
    let foundClone = false
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg.startsWith('-')) {
        continue
      }
      if (arg === 'clone') {
        foundClone = true
      }
      break
    }
    if (!foundClone) {
      continue
    }

    // Allow `git clone --help` / `git clone -h` (information only).
    if (args.includes('--help') || args.includes('-h')) {
      return { detected: false, hasDepth1: false, hasSingleBranch: false }
    }

    let hasDepth1 = false
    let hasSingleBranch = false

    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg === '--depth=1') {
        hasDepth1 = true
      } else if (arg === '--depth' && args[i + 1] === '1') {
        hasDepth1 = true
      } else if (arg === '--single-branch') {
        hasSingleBranch = true
      }
    }

    const detected = !hasDepth1 || !hasSingleBranch
    return { detected, hasDepth1, hasSingleBranch }
  }
  return { detected: false, hasDepth1: false, hasSingleBranch: false }
}

export function formatBlock(d: ShallowCloneDetection): string {
  const missing: string[] = []
  if (!d.hasDepth1) {
    missing.push('--depth=1')
  }
  if (!d.hasSingleBranch) {
    missing.push('--single-branch')
  }
  return (
    [
      `[shallow-clone-guard] Blocked: \`git clone\` is missing: ${missing.join(', ')}.`,
      '',
      '  A bare clone fetches the full object graph for every branch — slow and',
      '  unnecessary for review work. Always use both shallow flags:',
      '',
      '    git clone --depth=1 --single-branch <url> <dest>',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard((command, payload) => {
  const detection = detectShallowClone(command)
  if (!detection.detected) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  return block(formatBlock(detection))
})

export const hook = defineHook({
  bypass: ['shallow-clone'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
