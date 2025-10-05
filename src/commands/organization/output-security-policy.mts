/** @fileoverview Organization security policy output formatter for Socket CLI. Displays security policy settings in JSON, markdown, or text formats. Shows alert thresholds, issue actions, and scanning preferences. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { mdTableOfPairs } from '../../utils/markdown.mts'
import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputSecurityPolicy(
  result: CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      logger.log('# Security policy')
      logger.log('')
      logger.log(
        `The default security policy setting is: "${data.securityPolicyDefault}"`,
      )
      logger.log('')
      logger.log(
        'These are the security policies per setting for your organization:',
      )
      logger.log('')
      const rules = data.securityPolicyRules
      const entries: Array<
        [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' }]
      > = rules ? Object.entries(rules) : []
      const mapped: Array<[string, string]> = entries.map(
        ({ 0: key, 1: value }) => [key, value.action],
      )
      mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      logger.log(mdTableOfPairs(mapped, ['name', 'action']))
      logger.log('')
      return ''
    },
  })
}
