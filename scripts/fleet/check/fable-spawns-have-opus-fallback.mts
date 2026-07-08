// Fleet check — every claude-fable-5 / claude-mythos-5 spawn either routes
// through spawnTierWithFallback (which owns the fallback centrally) or the
// result is checked for `refused`/`servedByFallback` in the enclosing function.
// A fable spawn whose result binding is never inspected for the refusal signal
// is a silent-refusal bug — the caller treats a classifier refusal as success.
//
// CLAUDE.md AI-spawn rule: "A claude-fable-5 spawn MUST route the Opus-4.8
// refusal fallback; the fallback is configured once in spawnAiAgent and every
// spawn inherits it."
//
// Three rules:
//
//   1. A spawnAiAgent({model:'claude-fable-5',…}) / Workflow agent({…}) whose
//      result is not fallback-checked. "Fallback-checked" = the enclosing fn
//      scope reads `result.refused` / `.servedByFallback` / destructures
//      `{ refused` from the result binding.
//
//      NOTE — spawnTierWithFallback('fable',…) is exempt from this rule only
//      after socket-lib Step 1 lands the refused/servedByFallback fields on
//      AgentSpawnResult. Until then the tier call is still exempt by
//      convention (guard-only; fallback pending upstream lib Step 1).
//
//      Limitation: indirect model references (model: opts.updateModel) are
//      invisible to static analysis — coverage for those depends on the lib
//      unconditionally detecting refusals on the fable branch at runtime.
//
//      A fable spawn via bare spawnAiAgent whose result is only read for
//      exitCode is a violation.
//
//   2. A fable spawn (literal model or spawnTierWithFallback('fable',…)) sets a
//      budget / thinking knob — extraArgs containing --budget-tokens /
//      budget_tokens / thinking / --thinking-budget, or an effort key on a
//      fable-model call (adaptive-only; --effort is dropped for these models).
//
//   3. A hand-rolled spawn('claude'|'node','claude',…) argv that pushes
//      --model <fable> without going through spawnAiAgent / spawnTierWithFallback.
//
// Scan roots: scripts/**/*.mts, .claude/skills/**/*.mts,
//             .claude/hooks/**/*.mts, .claude/workflows/**/*.{js,mts}
//
// Exit codes: 0 — clean; 1 — at least one violation.
//
// Usage: node scripts/fleet/check/fable-spawns-have-opus-fallback.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  objectSpan,
  propValue,
  stringLiteral,
} from './ai-spawns-have-paired-effort.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const SCAN_GLOBS = [
  'scripts/**/*.mts',
  '.claude/skills/**/*.mts',
  '.claude/hooks/**/*.mts',
  '.claude/workflows/**/*.js',
  '.claude/workflows/**/*.mts',
] as const

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/*.test.mts',
  '**/test/**',
  '**/check/fable-spawns-have-opus-fallback.mts',
] as const

export interface FableViolation {
  readonly file: string
  readonly line: number
  readonly rule: 1 | 2 | 3
  readonly detail: string
}

// A model string is a Fable/Mythos model when it matches the adaptive-only
// regex used by buildArgs: /\b(?:fable|mythos)\b/i or /claude-(?:fable|mythos)/i.
export function isFableModel(model: string): boolean {
  return (
    /\b(?:fable|mythos)\b/i.test(model) ||
    /claude-(?:fable|mythos)/i.test(model)
  )
}

// Find the enclosing function body that wraps the call starting at `callStart`.
// Returns the substring from the nearest `{` that opened a function body to its
// matching close, or the rest of the file when no tight scope is found
// (conservative: treats the whole remaining text as the scope so we never miss
// a check that lives after the spawn call).
export function enclosingFnBody(text: string, callStart: number): string {
  let depth = 0
  let fnOpen = -1
  for (let i = 0; i < callStart; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      depth += 1
      fnOpen = i
    } else if (ch === '}') {
      depth -= 1
    }
  }
  if (fnOpen < 0) {
    return text.slice(callStart)
  }
  let d = 1
  for (let i = fnOpen + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      d += 1
    } else if (ch === '}') {
      d -= 1
      if (d === 0) {
        return text.slice(fnOpen, i + 1)
      }
    }
  }
  return text.slice(fnOpen)
}

// Does the enclosing function body contain a fallback-check reference?
// A fallback-check is: .refused / .servedByFallback / { refused / { servedByFallback.
export function hasFallbackCheck(fnBody: string): boolean {
  return (
    /\.refused\b/.test(fnBody) ||
    /\.servedByFallback\b/.test(fnBody) ||
    /\{\s*refused\b/.test(fnBody) ||
    /\{\s*servedByFallback\b/.test(fnBody)
  )
}

// Does the span contain a budget/thinking knob?
export function hasBudgetKnob(span: string): boolean {
  return /--budget-tokens|budget_tokens|--thinking-budget|thinking/.test(span)
}

// Rule 1 + Rule 2: scan spawnAiAgent({…}) and Workflow agent({…}) calls.
export function scanSpawnCalls(
  text: string,
): Array<{ index: number; rule: 1 | 2; detail: string }> {
  const hits: Array<{ index: number; rule: 1 | 2; detail: string }> = []
  const callRe = /(?:spawnAiAgent|\bagent)\s*\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(text))) {
    const callStart = m.index
    const braceAt = text.indexOf('{', callStart)
    if (braceAt < 0) {
      continue
    }
    const span = objectSpan(text, braceAt)
    if (!span) {
      continue
    }
    const modelVal = propValue(span, 'model')
    const modelStr = stringLiteral(modelVal)
    if (!modelStr || !isFableModel(modelStr)) {
      continue
    }
    // Rule 2: budget/thinking knob on a fable model.
    const effortVal = propValue(span, 'effort')
    const effortStr = stringLiteral(effortVal)
    const extraArgsVal = propValue(span, 'extraArgs')
    if (
      effortStr !== undefined ||
      (extraArgsVal !== undefined && hasBudgetKnob(extraArgsVal))
    ) {
      hits.push({
        index: callStart,
        rule: 2,
        detail: `Fable spawn (model '${modelStr}') sets a budget/thinking knob or an effort key — Fable is adaptive-only; --effort is dropped and no thinking-budget flag exists. Remove the knob.`,
      })
    }
    // Rule 1: result not fallback-checked in the enclosing function.
    const fnBody = enclosingFnBody(text, callStart)
    if (!hasFallbackCheck(fnBody)) {
      hits.push({
        index: callStart,
        rule: 1,
        detail: `Fable spawn (model '${modelStr}') result is not checked for \`refused\`/\`servedByFallback\`. Read these fields after the call, or route through spawnTierWithFallback('fable',…) (exempt; fallback pending upstream lib Step 1). See docs/agents.md/fleet/fable-fallback.md.`,
      })
    }
  }
  return hits
}

// Rule 1 (tier variant): spawnTierWithFallback('fable',…) — exempt from the
// fallback-check rule (it owns the fallback), but still check for budget knobs
// in the options arg (Rule 2).
export function scanTierCalls(
  text: string,
): Array<{ index: number; rule: 2; detail: string }> {
  const hits: Array<{ index: number; rule: 2; detail: string }> = []
  const tierRe = /spawnTierWithFallback\s*\(\s*['"]fable['"]/g
  let m: RegExpExecArray | null
  while ((m = tierRe.exec(text))) {
    const callStart = m.index
    let braceCount = 0
    let braceAt = -1
    for (let i = callStart; i < text.length; i += 1) {
      if (text[i] === '{') {
        braceCount += 1
        if (braceCount === 1) {
          braceAt = i
          break
        }
      }
    }
    if (braceAt < 0) {
      continue
    }
    const span = objectSpan(text, braceAt)
    if (!span) {
      continue
    }
    if (hasBudgetKnob(span)) {
      hits.push({
        index: callStart,
        rule: 2,
        detail: `spawnTierWithFallback('fable',…) options contain a budget/thinking knob — Fable is adaptive-only; remove the knob.`,
      })
    }
  }
  return hits
}

// Rule 3: hand-rolled spawn() / exec() argv that pushes --model <fable> without
// routing through spawnAiAgent / spawnTierWithFallback.
export function scanHandrolledArgv(
  text: string,
): Array<{ index: number; rule: 3; detail: string }> {
  const hits: Array<{ index: number; rule: 3; detail: string }> = []
  const modelFlagRe = /['"]--model['"]/g
  let m: RegExpExecArray | null
  while ((m = modelFlagRe.exec(text))) {
    const flagAt = m.index
    const lookahead = text.slice(flagAt, flagAt + 300)
    // A single-quoted or double-quoted string literal whose content contains
    // "fable" or "mythos" — the Fable/mythos model-id sub-string within the argv.
    const fableModelMatch = /['"]([^'"]*(?:fable|mythos)[^'"]*)['"]/.exec(
      lookahead,
    )
    if (!fableModelMatch) {
      continue
    }
    const modelId = fableModelMatch[1]!
    if (!isFableModel(modelId)) {
      continue
    }
    const windowStart = Math.max(0, flagAt - 300)
    const window = text.slice(windowStart, flagAt + 300)
    if (
      /spawnAiAgent/.test(window) ||
      /spawnTierWithFallback/.test(window) ||
      /buildArgs/.test(window)
    ) {
      continue
    }
    hits.push({
      index: flagAt,
      rule: 3,
      detail: `Hand-rolled argv pushes --model '${modelId}' without routing through spawnAiAgent/spawnTierWithFallback — bypasses the Opus-4.8 refusal fallback entirely. Use spawnAiAgent({model:'${modelId}',…}) or spawnTierWithFallback('fable',…) instead.`,
    })
  }
  return hits
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') {
      line += 1
    }
  }
  return line
}

export function scanFile(repoRoot: string, rel: string): FableViolation[] {
  const abs = path.join(repoRoot, rel)
  if (!existsSync(abs)) {
    return []
  }
  const text = readFileSync(abs, 'utf8')
  const out: FableViolation[] = []
  const hits = [
    ...scanSpawnCalls(text),
    ...scanTierCalls(text),
    ...scanHandrolledArgv(text),
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    out.push({
      detail: hit.detail,
      file: rel,
      line: lineOf(text, hit.index),
      rule: hit.rule,
    })
  }
  return out
}

export function scanRepo(repoRoot: string): FableViolation[] {
  const files = globSync([...SCAN_GLOBS], {
    cwd: repoRoot,
    ignore: [...IGNORE_GLOBS],
  })
  const out: FableViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    out.push(...scanFile(repoRoot, files[i]!))
  }
  return out
}

async function main(): Promise<void> {
  const violations = scanRepo(REPO_ROOT)
  if (violations.length) {
    logger.error(
      `Fable spawns missing refusal-fallback wiring (${violations.length}):`,
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(`  ${v.file}:${v.line} [rule ${v.rule}] — ${v.detail}`)
    }
    logger.error(
      'CLAUDE.md AI-spawn: a claude-fable-5 spawn must route the Opus-4.8 refusal fallback. See docs/agents.md/fleet/fable-fallback.md.',
    )
    process.exitCode = 1
    return
  }
  logger.success('All Fable spawns have refusal-fallback wiring.')
}

void (async () => {
  await main()
})().catch((err: unknown) => {
  logger.error(
    `fable-spawns-have-opus-fallback: unexpected error — ${errorMessage(err)}`,
  )
  process.exitCode = 1
})
