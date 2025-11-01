import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdTableOfPairs } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log(mdHeader('Security policy'))
  getDefaultLogger().log('')
  getDefaultLogger().log(
    `The default security policy setting is: "${result.data.securityPolicyDefault}"`,
  )
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'These are the security policies per setting for your organization:',
  )
  getDefaultLogger().log('')
  const rules = result.data.securityPolicyRules
  const entries: Array<
    [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' }]
  > = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ({ 0: key, 1: value }) => [key, value.action],
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  getDefaultLogger().log(mdTableOfPairs(mapped, ['name', 'action']))
  getDefaultLogger().log('')
}
