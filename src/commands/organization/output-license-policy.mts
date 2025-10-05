/** @fileoverview Organization license policy output formatter for Socket CLI. Displays license policy configuration in JSON, markdown, or text formats. Shows allowed and denied license lists. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { mdTableOfPairs } from '../../utils/markdown.mts'
import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputLicensePolicy(
  result: CResult<SocketSdkSuccessResult<'getOrgLicensePolicy'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      logger.info('Use --json to get the full result')
      logger.log('# License policy')
      logger.log('')
      logger.log('This is the license policy for your organization:')
      logger.log('')
      const rules = data['license_policy']!
      const entries = rules ? Object.entries(rules) : []
      const mapped: Array<[string, string]> = entries.map(
        ({ 0: key, 1: value }) =>
          [key, (value as any)?.['allowed'] ? ' yes' : ' no'] as const,
      )
      mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      logger.log(mdTableOfPairs(mapped, ['License Name', 'Allowed']))
      logger.log('')
      return ''
    },
  })
}
