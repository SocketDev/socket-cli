import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTableOfPairs } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputLicensePolicy(
  result: CResult<SocketSdkReturnType<'getOrgLicensePolicy'>['data']>,
  outputKind: OutputKind
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
    return
  }

  logger.error('Use --json to get the full result')
  logger.log('# License policy')
  logger.log('')
  logger.log('This is the license policy for your organization:')
  logger.log('')
  const rules = result.data['license_policy']!
  const entries = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ([key, value]) =>
      [key, (value as any)?.['allowed'] ? ' yes' : ' no'] as const
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  logger.log(mdTableOfPairs(mapped, ['License Name', 'Allowed']))
  logger.log('')
}
