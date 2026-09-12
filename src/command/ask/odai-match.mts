import { classifyIntent, withOdaiModel } from '@socketsecurity/odai/node'
import type { IntentResult } from '@socketsecurity/odai/node'
import type { TaskResult } from '@socketsecurity/odai'

export type OdaiAskMatch =
  | { status: 'suggested'; actionId: string }
  | {
      status: 'unresolved'
      reason: 'unavailable' | 'timed-out' | 'invalid' | 'abstained'
    }

export async function matchAskWithOdai(
  query: string,
  candidates: ReadonlyArray<{ id: string; description: string }>,
  options: { abortSignal?: AbortSignal | undefined } = {},
): Promise<OdaiAskMatch> {
  options.abortSignal?.throwIfAborted()
  try {
    const result = await withOdaiModel(
      model => classifyIntent(model, { query, candidates: [...candidates] }),
      { timeoutMs: 5000, abortSignal: options.abortSignal },
    )
    options.abortSignal?.throwIfAborted()
    return validateOdaiAskResult(result, candidates)
  } catch (error) {
    options.abortSignal?.throwIfAborted()
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    return {
      status: 'unresolved',
      reason:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timed-out'
          : 'unavailable',
    }
  }
}

export function validateOdaiAskResult(
  result: TaskResult<IntentResult>,
  candidates: ReadonlyArray<{ id: string; description: string }>,
): OdaiAskMatch {
  if (!result.ok || !result.data || Object.keys(result.data).length !== 1) {
    return { status: 'unresolved', reason: 'invalid' }
  }
  const { actionId } = result.data
  if (actionId === null) {
    return { status: 'unresolved', reason: 'abstained' }
  }
  if (
    typeof actionId !== 'string' ||
    !candidates.some(candidate => candidate.id === actionId)
  ) {
    return { status: 'unresolved', reason: 'invalid' }
  }
  return { status: 'suggested', actionId }
}
