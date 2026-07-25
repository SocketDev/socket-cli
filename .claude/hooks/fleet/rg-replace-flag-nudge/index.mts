/*
 * @file Claude Code PreToolUse hook — rg-replace-flag-nudge.
 *
 * ripgrep's `-r` short flag takes a VALUE, so inside a short-flag cluster
 * it consumes the REST of the cluster as the replacement text:
 *
 *   rg -rln pattern      # parses as: rg --replace 'ln' pattern
 *
 * — silently rewriting every match to the swallowed letters instead of
 * listing files with line numbers. The command exits 0, so the corrupted
 * output is invisible to a caller checking only exit codes.
 *
 * This hook fires when a Bash command invokes `rg` with a short-flag
 * cluster that puts `r` at a NON-final position (`-rln`, `-rn`, `-orn`).
 * Legitimate shapes stay silent: `r` as the LAST char of a cluster
 * (`-lnr <replacement>`) and a standalone `-r <replacement>` both read
 * the next argument as the replacement, which is what they say they do.
 * Stderr reminder; never blocks.
 */

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

export const triggers: readonly string[] = ['rg']

// rg short flags that take a value. When one appears mid-cluster, the rest
// of the cluster is that flag's value — for `r` that value is the swallowed
// replacement text this hook exists to catch; for any earlier one, the `r`
// is part of THAT flag's value, not `--replace`.
const VALUE_TAKING_SHORT_FLAGS = new Set([
  'A',
  'B',
  'C',
  'd',
  'E',
  'e',
  'f',
  'g',
  'j',
  'M',
  'm',
  'r',
  'T',
  't',
])

// A short-flag cluster: dash + 2 or more letters (`-rln`). A lone `-r` is
// the legitimate "next arg is the replacement" spelling, not a cluster.
const SHORT_FLAG_CLUSTER_RE = /^-[a-zA-Z]{2,}$/

export interface ReplaceClusterHit {
  readonly swallowed: string
  readonly token: string
}

/**
 * The replacement text a clustered `-r` would swallow from `token`, or
 * undefined when the token is not a `--replace` cluster hazard. Walks the
 * cluster left to right the way rg's parser does: the first value-taking
 * flag consumes the rest, so an `r` is only `--replace` when no other
 * value-taking flag precedes it, and only a hazard when letters follow it.
 */
export function swallowedReplacement(token: string): string | undefined {
  if (!SHORT_FLAG_CLUSTER_RE.test(token)) {
    return undefined
  }
  const cluster = token.slice(1)
  for (let i = 0; i < cluster.length; i += 1) {
    const ch = cluster[i]!
    if (ch === 'r') {
      // `r` last in the cluster reads the NEXT argument as the
      // replacement — the author asked for --replace and got it.
      return i === cluster.length - 1 ? undefined : cluster.slice(i + 1)
    }
    if (VALUE_TAKING_SHORT_FLAGS.has(ch)) {
      return undefined
    }
  }
  return undefined
}

/**
 * The first hazardous cluster token across the rg invocations in `command`,
 * with the replacement text it would swallow, or undefined when every rg
 * invocation is clean. Skips the value argument after a standalone
 * value-taking short flag (in `rg -r -rln pat` the `-rln` is a deliberate,
 * if odd, replacement) and everything after a literal `--` (patterns/paths).
 */
export function detectsReplaceCluster(
  command: string,
): ReplaceClusterHit | undefined {
  for (const cmd of commandsFor(command, 'rg')) {
    let skipValue = false
    for (const arg of cmd.args) {
      if (skipValue) {
        skipValue = false
        continue
      }
      if (arg === '--') {
        break
      }
      if (/^-[A-Za-z]$/.test(arg) && VALUE_TAKING_SHORT_FLAGS.has(arg[1]!)) {
        skipValue = true
        continue
      }
      const swallowed = swallowedReplacement(arg)
      if (swallowed !== undefined) {
        return { __proto__: null, swallowed, token: arg } as ReplaceClusterHit
      }
    }
  }
  return undefined
}

export const hook = defineHook({
  check: bashGuard(command => {
    const hit = detectsReplaceCluster(command)
    if (hit === undefined) {
      return undefined
    }
    const spelledApart = hit.swallowed
      .split('')
      .map(c => `-${c}`)
      .join(' ')
    return notify(
      [
        `[rg-replace-flag-nudge] \`${hit.token}\` runs \`rg --replace '${hit.swallowed}'\`, not the flags you clustered.`,
        '',
        "  rg's -r takes a value, so it consumes the REST of its short-flag",
        '  cluster as the replacement text. The command still exits 0, so the',
        '  corrupted output is easy to miss.',
        '',
        `  Saw:    rg ${hit.token} …   (parses as --replace '${hit.swallowed}')`,
        `  Wanted: -r spelled apart from ${spelledApart}, or no -r at all.`,
        '',
        '  Fix — spell every short flag separately, or use long flags:',
        '',
        `    rg ${spelledApart} <pattern>              # flags applied as flags`,
        "    rg --replace '<text>' <pattern>   # only when you MEAN a replacement",
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
