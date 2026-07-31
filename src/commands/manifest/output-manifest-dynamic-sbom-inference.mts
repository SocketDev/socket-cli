import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { RecursiveManifestOutcome } from './generate-recursive-manifests.mts'
import type { CResult, OutputKind } from '../../types.mts'

function renderTable(outcomes: readonly RecursiveManifestOutcome[]): string {
  return outcomes
    .map(
      o =>
        `- ${o.dir} (${o.ecosystem}): ${o.status}${o.factsPath ? ` -> ${o.factsPath}` : ''}`,
    )
    .join('\n')
}

function summarize(outcomes: readonly RecursiveManifestOutcome[]): string {
  const generated = outcomes.filter(o => o.status === 'generated').length
  const failed = outcomes.filter(o => o.status === 'failed').length
  const skippedCovered = outcomes.filter(
    o => o.status === 'skippedCovered',
  ).length
  const skippedDisabled = outcomes.filter(
    o => o.status === 'skippedDisabled',
  ).length
  const empty = outcomes.filter(o => o.status === 'empty').length
  const roots = new Set(outcomes.map(o => o.dir)).size
  return (
    `Generated ${generated} Socket facts file(s) across ${roots} build root(s); ` +
    `${failed} failed, ${skippedCovered} skipped (already covered), ` +
    `${skippedDisabled} skipped (disabled/pom), ${empty} empty.`
  )
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
