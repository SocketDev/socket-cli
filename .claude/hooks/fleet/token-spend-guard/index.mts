#!/usr/bin/env node
// Claude Code PreToolUse hook — token-spend-guard.
//
// Reminds (exit 2, non-fatal nudge) when a KNOWN-MECHANICAL command runs on a
// premium model or high reasoning effort. Mechanical work — cascades, lint-
// autofix sweeps, rename/path migrations — is dumb-bit propagation that a
// cheap/fast model at low/medium effort handles fine; spending `opus` +
// `high`/`xhigh`/`max` tokens on it is wasted money. Design work (architecture,
// ambiguous debugging, security review) is what the premium tier is for.
//
// Two signals, both observable to a PreToolUse hook:
//   - effort: the `$CLAUDE_EFFORT` env var (low|medium|high|xhigh|max), set by
//     the harness for tool-use-context hooks.
//   - model: read from the transcript's most-recent assistant event `model`
//     field (the payload itself carries no model outside SessionStart).
//
// Only fires on a command whose shape is unambiguously mechanical, so it never
// nags during real work. Reminder, not a hard block — but it sets exit 2 so the
// agent sees it and either drops the model/effort or types a bypass.
//
// Bypass: "Allow model bypass" (keep the premium model) or "Allow effort
// bypass" (keep high effort) in a recent user turn, or
// SOCKET_TOKEN_SPEND_GUARD_DISABLED=1.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent, readLines } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const MODEL_BYPASS = ['Allow model bypass', 'Allow model-spend bypass'] as const
const EFFORT_BYPASS = ['Allow effort bypass'] as const

// Effort levels that count as "premium" — the tiers worth conserving on
// mechanical work. low/medium are already cheap, so they never trigger.
const PREMIUM_EFFORT = new Set(['high', 'xhigh', 'max'])

// A model id is "premium" when it's an Opus. Sonnet/Haiku are the cheap/fast
// tier the guard nudges toward. Matches both alias and full-id shapes
// (`opus`, `claude-opus-4-8`, `claude-opus-4-8[1m]`).
function isPremiumModel(model: string): boolean {
  return /\bopus\b/i.test(model) || /claude-opus/i.test(model)
}

// Command shapes that are unambiguously mechanical. Kept deliberately narrow:
// a false trigger on real work would train the agent to reflex-bypass, which
// defeats the rule. Each entry is a substring/RE checked against the command.
const MECHANICAL_RE = [
  // Wheelhouse cascade sync + its commit.
  /\bpnpm\s+run\s+sync\b/,
  /chore\(wheelhouse\):\s*cascade\b/,
  // Mass autofix / format sweeps (the whole-tree variants, not a single file).
  /\b(?:pnpm\s+(?:run|exec)\s+)?(?:oxlint|eslint)\b[^\n]*--fix\b[^\n]*(?:\s\.|--all)\b/,
  /\b(?:pnpm\s+run\s+)?fix\b\s+--all\b/,
  /\boxfmt\b[^\n]*--write\b[^\n]*\s\.(?:\s|$)/,
] as const

function isMechanical(command: string): boolean {
  return MECHANICAL_RE.some(re => re.test(command))
}

// Read the model from the most-recent assistant event in the transcript.
// Returns '' when unreadable — the guard then can't judge the model and only
// considers effort.
function readCurrentModel(transcriptPath: string | undefined): string {
  const lines = readLines(transcriptPath)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line || !line.includes('"model"')) {
      continue
    }
    try {
      const evt = JSON.parse(line) as { model?: unknown; type?: unknown }
      if (typeof evt.model === 'string' && evt.model) {
        return evt.model
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return ''
}

await withBashGuard((command, payload) => {
  if (process.env['SOCKET_TOKEN_SPEND_GUARD_DISABLED']) {
    return
  }
  if (!isMechanical(command)) {
    return
  }

  const effort = String(process.env['CLAUDE_EFFORT'] ?? '').toLowerCase()
  const model = readCurrentModel(payload.transcript_path)

  const effortIsPremium = PREMIUM_EFFORT.has(effort)
  const modelIsPremium = !!model && isPremiumModel(model)

  // Each dimension is independently bypassable, so only flag the dimensions
  // that are both premium AND not bypassed for this turn.
  const flagModel =
    modelIsPremium &&
    !bypassPhrasePresent(payload.transcript_path, MODEL_BYPASS)
  const flagEffort =
    effortIsPremium &&
    !bypassPhrasePresent(payload.transcript_path, EFFORT_BYPASS)

  if (!flagModel && !flagEffort) {
    return
  }

  const lines = [
    '[token-spend-guard] Mechanical command on a premium setting.',
    '',
  ]
  if (flagModel) {
    lines.push(
      `  model  : ${model} — premium. Mechanical work runs fine on a`,
      '           cheap/fast model. Switch: /model sonnet  (or haiku).',
      '           Keep it for this task: type "Allow model bypass".',
    )
  }
  if (flagEffort) {
    lines.push(
      `  effort : ${effort} — premium. Drop it: /effort low  (or medium).`,
      '           Keep it for this task: type "Allow effort bypass".',
    )
  }
  lines.push(
    '',
    '  Mechanical = cascades, lint-autofix sweeps, rename/path migrations.',
    '  Reserve premium model + high effort for design, hard debugging,',
    '  security review. Disable entirely: SOCKET_TOKEN_SPEND_GUARD_DISABLED=1.',
    '',
  )
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
})
