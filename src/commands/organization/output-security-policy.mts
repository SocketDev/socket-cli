import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTableOfPairs } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputSecurityPolicy(
  result: CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>,
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

  logger.log('# Security policy')
  logger.log('')
  logger.log(
    `The default security policy setting is: "${result.data.securityPolicyDefault}"`,
  )
  logger.log('')
  logger.log(
    'These are the security policies per setting for your organization:',
  )
  logger.log('')
  const rules = result.data.securityPolicyRules
  const entries: Array<
    [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' }]
  > = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ({ 0: key, 1: value }) => [key, value.action],
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  logger.log(mdTableOfPairs(mapped, ['name', 'action']))
  logger.log('')
}
