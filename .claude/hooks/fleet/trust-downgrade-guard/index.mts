#!/usr/bin/env node
// Claude Code PreToolUse hook — trust-downgrade-guard.
//
// Blocks any action that WEAKENS a supply-chain trust gate unless the
// user has typed `Allow trust-downgrade bypass` — and the bypass is
// SINGLE-USE, never persisted (each prior downgrade this session
// consumes one phrase occurrence, like release-workflow-guard's
// per-dispatch model).
//
// Two trigger surfaces:
//
//   1. Bash commands that relax a policy at invocation time:
//      - `--config.trustPolicy=trust-all` (or any non-`no-downgrade`
//        value): disables pnpm's package-takeover protection.
//      - `--config.minimumReleaseAge=0` / `--no-verify-store-integrity`
//        / `--config.dangerouslyAllowAllBuilds` style relaxations.
//      - npm `--dangerously-allow-all-scripts`, `ignore-scripts=false`
//        flips on install.
//
//   2. Edit/Write that weakens a policy file:
//      - removing or downgrading `trustPolicy: no-downgrade` in
//        pnpm-workspace.yaml (to `trust-all` / `trust` / deleting it).
//      - deleting `blockExoticSubdeps: true`.
//      - lowering `minimumReleaseAge` below the fleet floor (10080).
//      - lowering the npm `.npmrc` `min-release-age` (days) below its floor —
//        the npm-side parallel of the pnpm `minimumReleaseAge` soak.
//
// The Bash surface AST-parses the command via _shared/shell-command.mts
// (per the no-command-regex-in-hooks rule) and inspects the pnpm/npm
// segment args, so a downgrade flag can't be smuggled behind a `&&`
// chain, quoting, or `$(…)` substitution, and a flag mentioned inside an
// unrelated quoted string never false-fires.
//
// Why this exists (incident 2026-05-27): an agent ran
// `pnpm install --config.trustPolicy=trust-all` to force a lockfile
// refresh past a stale-entry rejection — disabling the no-downgrade
// takeover protection to make a command succeed. The correct fix was
// to add the soak/exclude entry and re-resolve, never to relax the
// policy. CLAUDE.md "Never weaken a supply-chain trust gate" states
// the rule; this hook enforces it.
//
// Single-use bypass rationale: a persisted bypass (env var, or a phrase
// that authorizes every future downgrade in the session) is itself a
// trust downgrade. Each downgrade must be individually authorized.
//
// Verdict:
//   block — a trust downgrade without an unconsumed bypass phrase.
//   undefined — allowed (not a downgrade, or an unconsumed bypass is
//       present), and on any hook error (fail-open via runGuard).
//
// Reads a PreToolUse JSON payload (via runGuard):
//   { "tool_name": "Bash" | "Edit" | "Write" | "MultiEdit",
//     "tool_input": { "command"? , "file_path"?, "content"?, "new_string"? },
//     "transcript_path": "/.../session.jsonl" }

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor, parseCommands } from '../_shared/shell-command.mts'
import {
  detectNpmrcMinReleaseAgeDowngrade,
  MIN_RELEASE_AGE_MINUTES,
} from '../_shared/trust-gates.mts'
import { bypassPhraseRemaining } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow trust-downgrade bypass'

// Fleet minimumReleaseAge floor (minutes) — 7 days. A lower value is a
// downgrade. Owned by _shared/trust-gates.mts so the hook, the npm-key
// detector, and the commit-time check never disagree on the number.
const MIN_RELEASE_AGE_FLOOR = MIN_RELEASE_AGE_MINUTES

// Package managers whose flags can relax a trust gate at invocation time.
const TRUST_GATE_MANAGERS = ['pnpm', 'npm'] as const

// Split an arg token into its flag name and inline value. `--config.x=y`
// → ['--config.x', 'y']; `--no-verify-store-integrity` → [that, undefined].
function splitFlag(arg: string): { name: string; value: string | undefined } {
  const eq = arg.indexOf('=')
  return eq > 0
    ? { name: arg.slice(0, eq), value: arg.slice(eq + 1) }
    : { name: arg, value: undefined }
}

// The value for a flag, whether inline (`--flag=v`) or the next arg token
// (`--flag v`). Returns undefined when no value follows.
function valueOf(
  args: readonly string[],
  index: number,
  inlineValue: string | undefined,
): string | undefined {
  if (inlineValue !== undefined) {
    return inlineValue
  }
  const next = args[index + 1]
  return next !== undefined && !next.startsWith('-') ? next : undefined
}

// Inspect ONE parsed pnpm/npm command segment's args for a downgrade flag.
// AST-based (per the no-command-regex-in-hooks rule): the command line is
// tokenized by _shared/shell-command.mts first, so `&&` chains, quoting, and
// `$(…)` substitution can't smuggle a flag past us, and a flag mentioned
// inside an unrelated quoted string (a commit message, a grep arg) is not a
// segment arg and never matches.
function downgradeFlagInArgs(args: readonly string[]): string | undefined {
  // `pnpm config set <key> <value>` is the persisted-config form of a flag.
  if (args[0] === 'config' && args[1] === 'set') {
    const key = args[2]
    const value = args[3]
    if (
      key === 'trustPolicy' &&
      value !== undefined &&
      value !== 'no-downgrade'
    ) {
      return 'trustPolicy override to a value other than no-downgrade'
    }
    if (key === 'minimumReleaseAge' && Number(value) === 0) {
      return 'minimumReleaseAge override to 0'
    }
  }
  for (let i = 0, { length } = args; i < length; i += 1) {
    const { name, value: inline } = splitFlag(args[i]!)
    switch (name) {
      case '--config.trustPolicy': {
        const v = valueOf(args, i, inline)
        if (v !== undefined && v !== 'no-downgrade') {
          return 'trustPolicy override to a value other than no-downgrade'
        }
        break
      }
      case '--config.minimumReleaseAge': {
        if (Number(valueOf(args, i, inline)) === 0) {
          return 'minimumReleaseAge override to 0'
        }
        break
      }
      case '--no-verify-store-integrity':
        return '--no-verify-store-integrity'
      case '--dangerously-allow-all-scripts':
      case '--dangerously-allow-all-builds':
        return '--dangerously-allow-all-* escape hatch'
      case '--ignore-scripts':
      case '-ignore-scripts': {
        if (valueOf(args, i, inline) === 'false') {
          return 'ignore-scripts=false'
        }
        break
      }
      default:
        if (name.startsWith('--config.dangerously') && inline === 'true') {
          return '--config.dangerously* = true'
        }
    }
  }
  return undefined
}

export function detectBashDowngrade(command: string): string | undefined {
  // Cheap gate: if the command names no trust-gate manager AND no bare
  // downgrade flag, skip the tokenize. `parseCommands` returns segments whose
  // binary is the resolved manager; a `$VAR`-sourced binary collapses to ''
  // and is handled by also scanning every segment's args below.
  const commands = parseCommands(command)
  for (const manager of TRUST_GATE_MANAGERS) {
    for (const cmd of commandsFor(command, manager)) {
      const hit = downgradeFlagInArgs(cmd.args)
      if (hit) {
        return hit
      }
    }
  }
  // A downgrade flag on a variable-sourced or unrecognized binary (e.g.
  // `$PM install --no-verify-store-integrity`) still disables the gate —
  // scan args of any segment whose binary we could not resolve.
  for (const cmd of commands) {
    if (cmd.binary === 'npm' || cmd.binary === 'pnpm') {
      continue
    }
    if (cmd.binary === '' || cmd.viaVariable) {
      const hit = downgradeFlagInArgs(cmd.args)
      if (hit) {
        return hit
      }
    }
  }
  return undefined
}

// Is the edited file a supply-chain policy file we gate?
function isPolicyFile(filePath: string): boolean {
  const base = path.basename(filePath)
  return base === '.npmrc' || base === 'pnpm-workspace.yaml'
}

// Inspect the NEW text an Edit/Write would write. We can only see the
// replacement fragment (Edit `new_string`) or full `content` (Write),
// not the resulting whole file — so we flag the *removal/weakening
// shapes* that appear in the new text, and (for Write) the absence of
// the no-downgrade line when the file is being rewritten wholesale.
export function detectEditDowngrade(
  toolName: string,
  filePath: string,
  newText: string,
  fullContent: string | undefined,
): string | undefined {
  if (!isPolicyFile(filePath)) {
    return undefined
  }
  // A fragment that sets trustPolicy to a non-no-downgrade value.
  if (/trustPolicy\s*:\s*(?!no-downgrade\b)\S+/i.test(newText)) {
    return 'trustPolicy set to a value other than no-downgrade'
  }
  // Lowering minimumReleaseAge below the floor.
  const m = /minimumReleaseAge\s*:\s*(?<value>\d+)/i.exec(newText)
  if (m && Number(m.groups!.value) < MIN_RELEASE_AGE_FLOOR) {
    return `minimumReleaseAge lowered below the ${MIN_RELEASE_AGE_FLOOR} floor`
  }
  // npm's `.npmrc` `min-release-age` (days) is the npm-side soak — a parallel
  // gate to pnpm's `minimumReleaseAge`. A fragment that sets it below the day
  // floor is the npm equivalent downgrade. (Whole-file removal/lowering is
  // caught by the commit-time `trust-gates-are-not-weakened.mts` check, which
  // sees before+after; a fragment alone can't see a deletion.)
  if (path.basename(filePath) === '.npmrc') {
    const npmHit = detectNpmrcMinReleaseAgeDowngrade('', newText)
    if (npmHit) {
      return npmHit
    }
  }
  // A wholesale Write of pnpm-workspace.yaml that drops the
  // no-downgrade line entirely is a downgrade (the gate vanishes).
  if (
    (toolName === 'Write' || fullContent !== undefined) &&
    path.basename(filePath) === 'pnpm-workspace.yaml'
  ) {
    const body = fullContent ?? newText
    if (body && !/trustPolicy\s*:\s*no-downgrade\b/i.test(body)) {
      return 'pnpm-workspace.yaml rewritten without `trustPolicy: no-downgrade`'
    }
  }
  // Deleting blockExoticSubdeps — visible only if the Edit's new_string
  // shows the surrounding region without it is not detectable from a
  // fragment alone; a Write can be checked.
  if (
    (toolName === 'Write' || fullContent !== undefined) &&
    path.basename(filePath) === 'pnpm-workspace.yaml'
  ) {
    const body = fullContent ?? newText
    if (body && !/blockExoticSubdeps\s*:\s*true\b/i.test(body)) {
      return 'pnpm-workspace.yaml rewritten without `blockExoticSubdeps: true`'
    }
  }
  return undefined
}

// Count prior trust-downgrade actions in the assistant tool-use history
// — each consumes one bypass-phrase occurrence (single-use semantics).
// Mirrors release-workflow-guard's countPriorDispatches.
export function countPriorDowngrades(
  transcriptPath: string | undefined,
): number {
  if (!transcriptPath) {
    return 0
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return 0
  }
  let count = 0
  for (const line of raw.split('\n')) {
    if (!line) {
      continue
    }
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (
      !evt ||
      typeof evt !== 'object' ||
      (evt as Record<string, unknown>)['type'] !== 'assistant'
    ) {
      continue
    }
    const msg = (evt as { message?: unknown | undefined }).message
    const content =
      msg && typeof msg === 'object'
        ? (msg as { content?: unknown | undefined }).content
        : undefined
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (!part || typeof part !== 'object') {
        continue
      }
      const name = (part as { name?: unknown | undefined }).name
      const input = (part as { input?: unknown | undefined }).input
      if (typeof name !== 'string' || !input || typeof input !== 'object') {
        continue
      }
      const inp = input as Record<string, unknown>
      if (name === 'Bash' && typeof inp['command'] === 'string') {
        if (detectBashDowngrade(inp['command'])) {
          count += 1
        }
      } else if (
        (name === 'Edit' || name === 'MultiEdit' || name === 'Write') &&
        typeof inp['file_path'] === 'string'
      ) {
        const newText =
          (typeof inp['new_string'] === 'string' ? inp['new_string'] : '') ||
          (typeof inp['content'] === 'string' ? inp['content'] : '')
        const fullContent =
          typeof inp['content'] === 'string' ? inp['content'] : undefined
        if (detectEditDowngrade(name, inp['file_path'], newText, fullContent)) {
          count += 1
        }
      }
    }
  }
  return count
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const tool = payload.tool_name
  const input = payload.tool_input
  let downgrade: string | undefined

  if (tool === 'Bash') {
    const command = input?.command
    if (typeof command === 'string' && command.trim()) {
      downgrade = detectBashDowngrade(command)
    }
  } else if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    const filePath = input?.file_path
    if (typeof filePath === 'string' && filePath) {
      const newText =
        (typeof input?.new_string === 'string' ? input.new_string : '') ||
        (typeof input?.content === 'string' ? input.content : '')
      const fullContent =
        typeof input?.content === 'string' ? input.content : undefined
      downgrade = detectEditDowngrade(tool, filePath, newText, fullContent)
    }
  }

  if (!downgrade) {
    return undefined
  }

  // Single-use bypass: total phrase occurrences minus prior downgrades
  // already performed this session. > 0 means an unconsumed phrase
  // authorizes THIS one.
  const prior = countPriorDowngrades(payload.transcript_path)
  const remaining = bypassPhraseRemaining(
    payload.transcript_path,
    BYPASS_PHRASE,
    prior,
  )
  if (remaining > 0) {
    return undefined
  }

  return block(
    [
      `[trust-downgrade-guard] Blocked: ${downgrade}`,
      '',
      '  This WEAKENS a supply-chain trust gate (package-takeover /',
      '  malicious-install protection). Disabling the policy to make a',
      '  command succeed is never the fix.',
      '',
      '  If a stale lockfile is being rejected: add the soak / exclude',
      '  entry for the specific version and re-resolve — keep the policy.',
      '',
      `  Bypass (single-use, NOT persisted): the user types`,
      `    "${BYPASS_PHRASE}"`,
      '  verbatim in chat, then retry. Each downgrade needs its own phrase.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
