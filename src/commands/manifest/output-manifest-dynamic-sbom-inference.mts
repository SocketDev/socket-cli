import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { RecursiveManifestOutcome } from './generate-recursive-manifests.mts'
import type { CResult, OutputKind } from '../../types.mts'

function renderTable(outcomes: readonly RecursiveManifestOutcome[]): string {
  // A covered reactor member is implied by its parent's line above it.
  return outcomes
    .filter(o => o.status !== 'skippedCovered')
    .map(
      o =>
        `- ${o.dir} (${o.ecosystem}): ${o.status}${o.factsPath ? ` -> ${o.factsPath}` : ''}`,
    )
    .join('\n')
}

function summarize(outcomes: readonly RecursiveManifestOutcome[]): string {
  const generated = outcomes.filter(o => o.status === 'generated').length
  return `Generated ${generated} Socket facts file(s).`
}

export async function outputManifestDynamicSbomInference(
  result: CResult<RecursiveManifestOutcome[]>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    const data = result.data as RecursiveManifestOutcome[] | undefined
    if (Array.isArray(data)) {
      logger.log(renderTable(data))
      logger.log(summarize(data))
    }
    return
  }

  if (outputKind === 'markdown') {
    logger.log(
      [
        '# Dynamic SBOM inference',
        '',
        renderTable(result.data),
        '',
        summarize(result.data),
      ].join('\n'),
    )
    return
  }

  logger.log(renderTable(result.data))
  logger.log(summarize(result.data))
}
