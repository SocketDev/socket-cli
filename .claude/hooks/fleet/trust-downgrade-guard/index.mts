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
// Exit codes:
//   2 — blocked (a trust downgrade without an unconsumed bypass phrase).
//   0 — allowed (not a downgrade, or an unconsumed bypass is present),
//       and on any hook error (fail-open + stderr log).
//
// Disabled via `SOCKET_TRUST_DOWNGRADE_GUARD_DISABLED=1` — note this env
// var ITSELF is a persisted trust downgrade; it exists only for the
// hook's own test harness and emergency wedged-session recovery.
//
// Reads a PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash" | "Edit" | "Write" | "MultiEdit",
//     "tool_input": { "command"? , "file_path"?, "content"?, "new_string"? },
//     "transcript_path": "/.../session.jsonl" }

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhraseRemaining, readStdin } from '../_shared/transcript.mts'

interface Payload {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly command?: unknown | undefined
        readonly file_path?: unknown | undefined
        readonly content?: unknown | undefined
        readonly new_string?: unknown | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

const ENV_DISABLE = 'SOCKET_TRUST_DOWNGRADE_GUARD_DISABLED'
const BYPASS_PHRASE = 'Allow trust-downgrade bypass'

// Fleet minimumReleaseAge floor (minutes) — 7 days. A lower value is a
// downgrade.
const MIN_RELEASE_AGE_FLOOR = 10080

// Bash-command patterns that relax a trust gate at invocation time.
// Matched against the raw command; these are flag shapes, not command
// structure, so a regex match is the right tool (a flag can't be
// "hidden" behind shell indirection the way a binary name can — the
// flag string has to appear literally for pnpm/npm to parse it).
const BASH_DOWNGRADE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  {
    re: /--config\.trustPolicy[=\s]+(?!no-downgrade\b)\S+/i,
    label: 'trustPolicy override to a value other than no-downgrade',
  },
  {
    re: /--config\.minimumReleaseAge[=\s]+0\b/i,
    label: 'minimumReleaseAge override to 0',
  },
  {
    re: /--no-verify-store-integrity\b/i,
    label: '--no-verify-store-integrity',
  },
  {
    re: /--dangerously-allow-all-(?:scripts|builds)\b/i,
    label: '--dangerously-allow-all-* escape hatch',
  },
  {
    re: /--config\.dangerously\S*=\s*true\b/i,
    label: '--config.dangerously* = true',
  },
  {
    re: /(?:^|\s)--?ignore-scripts[=\s]+false\b/i,
    label: 'ignore-scripts=false',
  },
]

export function detectBashDowngrade(command: string): string | undefined {
  for (let i = 0, { length } = BASH_DOWNGRADE_PATTERNS; i < length; i += 1) {
    const { re, label } = BASH_DOWNGRADE_PATTERNS[i]!
    if (re.test(command)) {
      return label
    }
  }
  return undefined
}

// Is the edited file a supply-chain policy file we gate?
function isPolicyFile(filePath: string): boolean {
  const base = path.basename(filePath)
  return base === 'pnpm-workspace.yaml' || base === '.npmrc'
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
  const m = /minimumReleaseAge\s*:\s*(\d+)/i.exec(newText)
  if (m && Number(m[1]) < MIN_RELEASE_AGE_FLOOR) {
    return `minimumReleaseAge lowered below the ${MIN_RELEASE_AGE_FLOOR} floor`
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
    const msg = (evt as { message?: unknown }).message
    const content =
      msg && typeof msg === 'object'
        ? (msg as { content?: unknown }).content
        : undefined
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (!part || typeof part !== 'object') {
        continue
      }
      const name = (part as { name?: unknown }).name
      const input = (part as { input?: unknown }).input
      if (typeof name !== 'string' || !input || typeof input !== 'object') {
        continue
      }
      const inp = input as Record<string, unknown>
      if (name === 'Bash' && typeof inp['command'] === 'string') {
        if (detectBashDowngrade(inp['command'])) {
          count += 1
        }
      } else if (
        (name === 'Edit' || name === 'Write' || name === 'MultiEdit') &&
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

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
  const raw = await readStdin()
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }

  const tool = payload.tool_name
  const input = payload.tool_input
  let downgrade: string | undefined

  if (tool === 'Bash') {
    const command = input?.command
    if (typeof command === 'string' && command.trim()) {
      downgrade = detectBashDowngrade(command)
    }
  } else if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
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
    process.exit(0)
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
    process.exit(0)
  }

  process.stderr.write(
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
    ].join('\n') + '\n',
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[trust-downgrade-guard] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
  process.exit(0)
})
