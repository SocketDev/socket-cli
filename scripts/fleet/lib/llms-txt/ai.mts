/**
 * @file AI slot fill step for the llms.txt generator. Calls spawnAiAgent with
 *   the four lockdown flags (AI_PROFILE.read, permissionMode dontAsk) using
 *   claude-haiku-4-5/low as the primary tier, escalating once to
 *   claude-sonnet-4-6/medium on validation failure. Any failure after retry
 *   returns an error — never a partial or empty result.
 *   Telemetry is off/fail-closed via AI_PROFILE.read + spawnAiAgent which sets
 *   --no-session-persistence and never touches the keychain or clipboard.
 */

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'

import type { SlotFillResponse } from './types.mts'

const FLOOR_MODEL = 'claude-haiku-4-5'
const FLOOR_EFFORT = 'low' as const

// Escalation tier — single retry step above the floor.
const ESCALATE_MODEL = 'claude-sonnet-4-6'
// Medium effort justified: prose slot validation failures indicate content
// quality issues that benefit from stronger reasoning.
const ESCALATE_EFFORT = 'medium' as const

const AI_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Validate a raw JSON string from the AI as a slot fill response.
 */
export function parseSlotResponse(
  raw: string,
  expectedIds: readonly string[],
): SlotFillResponse | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return undefined
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('slots' in parsed) ||
    typeof (parsed as Record<string, unknown>)['slots'] !== 'object'
  ) {
    return undefined
  }
  const slots = (parsed as { slots: Record<string, unknown> }).slots
  // Validate all expected ids are present with string values.
  for (const id of expectedIds) {
    if (typeof slots[id] !== 'string') return undefined
  }
  // Strip unknown keys — never pass through unexpected content.
  const cleaned: Record<string, string> = {}
  for (const id of expectedIds) {
    cleaned[id] = slots[id] as string
  }
  return { slots: cleaned }
}

/**
 * Validate per-slot rules: no newlines, char budget, no forbidden patterns.
 */
export function validateSlotContent(
  slots: Record<string, string>,
  charBudgets: Record<string, number>,
): string[] {
  const errors: string[] = []
  const FORBIDDEN = ['http', '](', './', '../']
  for (const [id, text] of Object.entries(slots)) {
    if (text.includes('\n')) {
      errors.push(`${id}: contains newline`)
    }
    const budget = charBudgets[id]
    if (budget !== undefined && text.length > budget) {
      errors.push(`${id}: ${text.length} chars exceeds budget of ${budget}`)
    }
    for (const pat of FORBIDDEN) {
      if (text.includes(pat)) {
        errors.push(`${id}: contains forbidden pattern "${pat}"`)
      }
    }
  }
  return errors
}

/**
 * Check whether a Claude CLI is reachable.
 */
export async function hasClaudeCli(cwd: string): Promise<boolean> {
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  return 'claude' in discovered
}

/**
 * Call the AI to fill prose slots. Returns filled slots on success or an
 * error string. Never returns partial content — on failure returns the
 * error string and the caller must not write.
 */
export async function fillSlots(
  prompt: string,
  expectedIds: readonly string[],
  charBudgets: Record<string, number>,
  cwd: string,
): Promise<{ slots: Record<string, string> } | { error: string }> {
  async function attempt(
    model: string,
    effort: typeof FLOOR_EFFORT | typeof ESCALATE_EFFORT,
  ): Promise<
    | { slots: Record<string, string> }
    | { parseError: string }
    | { validationErrors: string[] }
  > {
    const { exitCode, stdout, stderr } = await spawnAiAgent({
      ...AI_PROFILE.read,
      // Prompt-only: the AI has no tools (READ profile) and must respond purely
      // as JSON output. permissionMode dontAsk blocks any tool call attempt.
      cwd,
      effort,
      model,
      prompt,
      timeoutMs: AI_TIMEOUT_MS,
    })
    if (exitCode !== 0) {
      return { parseError: `exit ${exitCode}: ${stderr.trim()}` }
    }
    const parsed = parseSlotResponse(stdout, expectedIds)
    if (parsed === undefined) {
      return {
        parseError: `invalid JSON from AI: ${stdout.trim().slice(0, 200)}`,
      }
    }
    const errors = validateSlotContent(parsed.slots, charBudgets)
    if (errors.length > 0) {
      return { validationErrors: errors }
    }
    return { slots: parsed.slots }
  }

  // First attempt: floor tier.
  const first = await attempt(FLOOR_MODEL, FLOOR_EFFORT)
  if ('slots' in first) return first
  const firstError =
    'parseError' in first ? first.parseError : first.validationErrors.join('; ')

  // Single escalation: sonnet/medium on validation failures or parse errors.
  // Justification: stronger reasoning improves structural and content quality.
  const second = await attempt(ESCALATE_MODEL, ESCALATE_EFFORT)
  if ('slots' in second) return second
  const secondError =
    'parseError' in second
      ? second.parseError
      : second.validationErrors.join('; ')

  return {
    error: `AI fill failed after retry. First: ${firstError}. Second: ${secondError}`,
  }
}
