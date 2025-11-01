import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdTableOfPairs } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputLicensePolicy(
  result: CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().info('Use --json to get the full result')
  getDefaultLogger().log(mdHeader('License policy'))
  getDefaultLogger().log('')
  getDefaultLogger().log('This is the license policy for your organization:')
  getDefaultLogger().log('')
  const rules = result.data['license_policy']!
  const entries = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ({ 0: key, 1: value }) =>
      [key, (value as any)?.allowed ? ' yes' : ' no'] as const,
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  getDefaultLogger().log(mdTableOfPairs(mapped, ['License Name', 'Allowed']))
  getDefaultLogger().log('')
}
