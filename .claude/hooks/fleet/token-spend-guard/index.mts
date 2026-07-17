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

import process from 'node:process'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent, readLines } from '../_shared/transcript.mts'

const MODEL_BYPASS = ['Allow model bypass', 'Allow model-spend bypass'] as const
const EFFORT_BYPASS = ['Allow effort bypass'] as const

// Effort levels that count as "premium" — the tiers worth conserving on
// mechanical work. low/medium are already cheap, so they never trigger.
const PREMIUM_EFFORT = new Set(['high', 'max', 'xhigh'])

// A model id is "premium" when it's an Opus OR a Fable/Mythos (the apex tier,
// ~2× the cost of Opus). Sonnet/Haiku are the cheap/fast tier the guard nudges
// toward. Matches both alias and full-id shapes (`opus`, `claude-opus-4-8`,
// `claude-opus-4-8[1m]`, `fable`, `claude-fable-5`, `claude-mythos-5`).
function isPremiumModel(model: string): boolean {
  return (
    /\b(?:opus|fable|mythos)\b/i.test(model) ||
    /claude-(?:opus|fable|mythos)/i.test(model)
  )
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
      const evt = JSON.parse(line) as {
        model?: unknown | undefined
        type?: unknown | undefined
      }
      if (typeof evt.model === 'string' && evt.model) {
        return evt.model
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return ''
}

export const check = bashGuard((command, payload) => {
  if (!isMechanical(command)) {
    return undefined
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
    return undefined
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
    '  security review.',
    '',
    '  Cheapest path — DELEGATE the mechanical step to a cheaper tier instead',
    '  of downgrading your whole session: spawn a subagent at a low tier to run',
    "  it (the Agent tool with model: 'haiku', or `spawnAiAgent` from",
    '  @socketsecurity/lib with a low AI_PROFILE). The subagent runs the command',
    '  cheap + returns; your premium session keeps its context for the real work.',
    '',
    '  Report-back contract: a foreground Agent call returns the child’s final',
    '  text as YOUR tool result; a background delegate re-invokes you when it',
    '  completes. A delegate can NEVER SendMessage you (you are not addressable',
    '  to it) — do not instruct it to, and never end your turn waiting on a',
    '  delegate’s message.',
    '',
  )
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
