import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader, mdTableOfPairs } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export async function outputLicensePolicy(
  result: CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>,
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
    return
  }

  logger.info('Use --json to get the full result')
  logger.log(mdHeader('License policy'))
  logger.log('')
  logger.log('This is the license policy for your organization:')
  logger.log('')
  const rules = result.data['license_policy']!
  const entries = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ({ 0: key, 1: value }) =>
      [
        key,
        value &&
        typeof value === 'object' &&
        'allowed' in value &&
        value.allowed
          ? ' yes'
          : ' no',
      ] as const,
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  logger.log(mdTableOfPairs(mapped, ['License Name', 'Allowed']))
  logger.log('')
}
