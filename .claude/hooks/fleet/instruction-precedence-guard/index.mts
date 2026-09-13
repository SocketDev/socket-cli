// @hook-doc docs/fleet/agents.md/parallel-claude-sessions.md

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readQuestionTexts } from '../_shared/payload.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Acknowledged user directive, with optional timing or exclusivity qualifiers.
const USER_INSTRUCTION =
  /\b(?:you\s+(?:explicitly\s+)?(?:asked|directed|instructed|requested|said)|your\s+(?:(?:[\w]+-only|earlier|explicit|original|previous|standing)\s+)*(?:decision|directive|instruction|request|requirement))\b/i
// A peer actor or current repository state is offered as a competing authority.
const COMPETING_CHANGE =
  /\b(?:(?:agent|repo(?:sitory)?|session)\s+(?:change|commit|edit)|(?:another|concurrent|different|other|parallel)\s+(?:agent|assistant|developer|session)|(?:the\s+)?(?:branch|checkout|repo(?:sitory)?)\s+(?:currently|now))\b/i
// Only questions that ask which instruction or policy to follow.
const RECONSIDER_POLICY =
  /\b(?:(?:do\s+you\s+want|would\s+you\s+like)\s+(?:me|us)\s+to\s+(?:follow|honou?r|keep)\s+your|should\s+(?:I|we)\s+(?:apply|follow|honou?r|keep|restore|retain|use)\s+(?:the\s+(?:(?:another|concurrent|other|parallel)\s+)?(?:agent|repo(?:sitory)?|session|user)['’]?s?|your)|which\s+(?:approach|change|configuration|decision|directive|instruction|policy|request|requirement|version)\s+(?:do|should)\s+(?:I|we)\s+(?:apply|follow|honou?r|keep|retain|use))\b/i
// Conflicting user directives remain valid reasons to clarify.
const USER_CONFLICT =
  /\b(?:(?:conflicting|contradictory)\s+user\s+(?:instructions|requests|requirements)|you\s+(?:also|later|subsequently)\s+(?:asked|instructed|requested|said)|your\s+(?:two\s+)?(?:instructions|requests|requirements)\s+(?:conflict|contradict))\b/i
// System and developer constraints retain their instruction priority.
const HIGHER_PRIORITY =
  /\b(?:(?:developer|system)\s+(?:constraint|instruction|policy|requirement)|higher[- ]priority\s+(?:constraint|instruction|policy|requirement))s?\b/i

export function asksToOverrideUserInstruction(text: string): boolean {
  return (
    USER_INSTRUCTION.test(text) &&
    COMPETING_CHANGE.test(text) &&
    RECONSIDER_POLICY.test(text) &&
    !USER_CONFLICT.test(text) &&
    !HIGHER_PRIORITY.test(text)
  )
}

export function check(payload: ToolCallPayload): GuardResult {
  if (payload.tool_name !== 'AskUserQuestion') {
    return undefined
  }
  if (!readQuestionTexts(payload).some(asksToOverrideUserInstruction)) {
    return undefined
  }
  return block(
    'instruction-precedence-guard: Follow the explicit user instruction; a peer change cannot override it. Do not ask the user to choose again.',
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['AskUserQuestion'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
