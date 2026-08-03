/*
 * @file Claude Code PreToolUse hook — rg-replace-flag-guard.
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
 * This hook BLOCKS when a Bash command invokes `rg` with a short-flag
 * cluster that puts `r` at a NON-final position (`-rln`, `-rn`, `-orn`).
 * The hazard is deterministic and the correction is mechanical — spell the
 * flags apart — so there is no judgment to preserve in an advisory.
 * Legitimate shapes stay silent: `r` as the LAST char of a cluster
 * (`-lnr <replacement>`) and a standalone `-r <replacement>` both read
 * the next argument as the replacement, which is what they say they do,
 * as does the long `--replace <text>` spelling.
 *
 * Fails open on parse / payload errors — a guard bug must not wedge every
 * Bash call.
 */

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
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

// Longest command echoed back in the Where line. Past this the operator
// already knows which command they typed, and a heredoc or a long chain
// would flood the block message.
const WHERE_MAX_LENGTH = 160

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

/**
 * The single-line command echo for the Where section, whitespace-collapsed
 * and truncated to WHERE_MAX_LENGTH.
 */
export function summarizeRgCommand(command: string): string {
  const oneLine = command.replace(/\s+/gu, ' ').trim()
  return oneLine.length > WHERE_MAX_LENGTH
    ? `${oneLine.slice(0, WHERE_MAX_LENGTH - 1)}…`
    : oneLine
}

/**
 * The What / Where / Saw vs wanted / Fix block message for `hit`, as seen in
 * `command`. The Fix spells both corrected commands literally because the
 * whole failure mode is that the author never meant `--replace` at all.
 */
export function formatReplaceClusterBlock(
  hit: ReplaceClusterHit,
  command: string,
): string {
  const spelledApart = hit.swallowed
    .split('')
    .map(c => `-${c}`)
    .join(' ')
  return [
    `[rg-replace-flag-guard] \`${hit.token}\` runs \`rg --replace '${hit.swallowed}'\`, not the flags you clustered.`,
    '',
    "  What:   rg's -r/--replace takes a VALUE, so inside a short-flag cluster",
    '          it swallows the REST of the cluster as the replacement text.',
    `          Every match prints as '${hit.swallowed}' instead of the real line,`,
    '          and rg still exits 0, so nothing downstream notices.',
    '',
    `  Where:  ${summarizeRgCommand(command)}`,
    '',
    `  Saw:    rg --replace '${hit.swallowed}' …   (parsed out of \`${hit.token}\`)`,
    `  Wanted: ${spelledApart} applied as flags, with no replacement at all.`,
    '',
    '  Fix — spell the flags separately:',
    '',
    `    rg ${spelledApart} <pattern>`,
    '',
    '  Or, only if you really did mean a replacement, spell -r apart too:',
    '',
    `    rg -r '<text>' ${spelledApart} <pattern>`,
    '',
  ].join('\n')
}

export const hook = defineHook({
  bypass: ['rg-replace-cluster'],
  check: bashGuard(command => {
    const hit = detectsReplaceCluster(command)
    if (hit === undefined) {
      return undefined
    }
    return block(formatReplaceClusterBlock(hit, command))
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
