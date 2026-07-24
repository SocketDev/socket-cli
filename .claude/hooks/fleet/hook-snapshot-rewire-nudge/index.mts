/*
 * @file Claude Code PreToolUse hook — hook-snapshot-rewire-nudge.
 *
 * NON-BLOCKING. Fires when a hand edit wires the per-machine V8-snapshot
 * launcher (`dispatch-launcher`) into `.claude/settings.json`'s hook-dispatch
 * commands — the wrong turn this nudge exists to catch.
 *
 * The dispatch wiring is PER-MACHINE snapshot state owned by
 * `node scripts/fleet/setup/hook-snapshot.mts` (idempotent). Every fleet cascade
 * rewrites `settings.json` to `merge(template, repo-hooks)`, which reverts the
 * dispatch commands to the portable baseline (`index.cjs`) — SAFE and
 * correct on CI / a fresh checkout / a member, where the launcher was never set
 * up.
 *
 * Crucially, the `hook-snapshot-is-wired` check ("hook-snapshot-is-active")
 * only fires on a machine that OPTED IN (the native launcher exists) AND is
 * RELEASE-tier: it gates `github-release.yml`, NOT `⚡ CI` (which runs the
 * interactive `pnpm run check --all`). So a reverted wiring never reds ⚡ CI, and
 * hand-editing `settings.json` to chase that check is wasted effort. Re-wire with
 * the setup script, or ignore it for a ⚡-CI-green fix.
 *
 * Detects an Edit/Write whose `file_path` is `.claude/settings.json` and whose
 * incoming content introduces `dispatch-launcher`, and a Bash write (`sed -i`,
 * `tee`, `>`/`>>` redirect) of `dispatch-launcher` into `settings.json`. Reads
 * are ignored; fails open on parse errors — a nudge must never wedge a call.
 *
 * Convention: docs/agents.md/fleet/hook-registry.md.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  bashGuard,
  defineHook,
  editGuard,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import type { GuardResult, ToolCallPayload } from '../_shared/guard.mts'

// The per-machine snapshot launcher binary name; its presence in a settings.json
// dispatch command means the fast path was hand-wired (the cascade never adds it).
const LAUNCHER_TOKEN = 'dispatch-launcher'

// Bash write verbs whose target settings.json means a re-wire (not a read).
const WRITE_TO_FILE = new Set(['tee'])

export const triggers: readonly string[] = [LAUNCHER_TOKEN]

// True when a path arg points at the live `.claude/settings.json`.
export function isSettingsJson(arg: string): boolean {
  const p = normalizePath(arg)
  return p === '.claude/settings.json' || p.endsWith('/.claude/settings.json')
}

/**
 * True when a Bash command WRITES the launcher into `.claude/settings.json` — a
 * `sed -i`, a `tee`, or a `>`/`>>` redirect whose target is settings.json, with
 * the launcher token present. Reads (`grep`/`cat` of settings.json) are
 * ignored.
 */
export function rewiresSettingsInBash(command: string): boolean {
  if (!command.includes(LAUNCHER_TOKEN)) {
    return false
  }
  // Match `>` / `>>` redirects, capturing the (optionally quoted) target path
  // and stopping at whitespace or the next shell operator (`|`, `;`, `&`).
  const redirects = command.match(/>>?\s*("?)([^\s"'|;&]+)\1/g) ?? []
  for (let i = 0, { length } = redirects; i < length; i += 1) {
    const target = redirects[i]!.replace(/^>>?\s*["']?/, '').replace(
      /["']$/,
      '',
    )
    if (isSettingsJson(target)) {
      return true
    }
  }
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const cmd = commands[i]!
    const bare = cmd.args.filter(a => !a.startsWith('-'))
    const isSedInPlace =
      cmd.binary === 'sed' &&
      cmd.args.some(a => a === '-i' || a.startsWith('-i') || a === '--in-place')
    if (
      (isSedInPlace || WRITE_TO_FILE.has(cmd.binary)) &&
      bare.some(isSettingsJson)
    ) {
      return true
    }
  }
  return false
}

export function nudgeMessage(): string {
  return (
    [
      '[hook-snapshot-rewire-nudge] Heads up: this hand-wires `dispatch-launcher`',
      'into `.claude/settings.json`.',
      '',
      '  That dispatch wiring is PER-MACHINE snapshot state owned by',
      '  `node scripts/fleet/setup/hook-snapshot.mts` (idempotent). Every fleet',
      '  cascade reverts it to the portable baseline (`index.cjs`) —',
      '  which is correct on CI / a fresh checkout / a member.',
      '',
      '  The `hook-snapshot-is-wired` check ("hook-snapshot-is-active") is',
      '  RELEASE-tier only: it gates `github-release.yml`, NOT `⚡ CI` (which runs',
      '  the interactive `pnpm run check --all`). A reverted wiring never reds',
      '  ⚡ CI, so hand-editing settings.json to chase it is wasted effort.',
      '',
      '  Fix: run `node scripts/fleet/setup/hook-snapshot.mts` to re-wire, or',
      '  ignore it for a ⚡-CI-green fix. See docs/agents.md/fleet/hook-registry.md.',
    ].join('\n') + '\n'
  )
}

const editCheck = editGuard((filePath, content) => {
  if (!isSettingsJson(filePath) || !content?.includes(LAUNCHER_TOKEN)) {
    return undefined
  }
  return notify(nudgeMessage())
})

const bashCheck = bashGuard(command => {
  if (!rewiresSettingsInBash(command)) {
    return undefined
  }
  return notify(nudgeMessage())
})

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  return (await editCheck(payload)) ?? (await bashCheck(payload))
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'nudge',
})
void runHook(hook, import.meta.url)
