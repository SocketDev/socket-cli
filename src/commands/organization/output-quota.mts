/**
 * @fileoverview Output organization quota in various formats.
 */

import { simpleTable } from '../../utils/simple-output.mts'

import type { QuotaResult } from './fetch-quota.mts'
import type { OutputKind } from '../../types.mts'

/**
 * Output organization quota in the specified format.
 */
export function outputQuota(
  result: QuotaResult,
  outputKind: OutputKind,
): void {
  if (outputKind === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    console.log('## Organization Quota\n')
    console.log(`- **Used**: ${result.used}`)
    console.log(`- **Limit**: ${result.limit}`)
    console.log(`- **Percentage**: ${result.percentage}%`)
    console.log(`- **Period**: ${result.period}`)
    return
  }

  // Default table output
  const table = simpleTable({
    headers: ['Metric', 'Value'],
    rows: [
      ['Used', String(result.used)],
      ['Limit', String(result.limit)],
      ['Percentage', `${result.percentage}%`],
      ['Period', result.period],
    ],
  })

  console.log(table)
}