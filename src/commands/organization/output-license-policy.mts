/**
 * @fileoverview Output organization license policy in various formats.
 */

import { simpleTable } from '../../utils/simple-output.mts'

import type { LicensePolicyResult } from './fetch-license-policy.mts'
import type { OutputKind } from '../../types.mts'

/**
 * Output organization license policy in the specified format.
 */
export function outputLicensePolicy(
  result: LicensePolicyResult,
  outputKind: OutputKind,
): void {
  if (outputKind === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    console.log('## License Policy\n')
    console.log(`**Default Action**: ${result.defaultAction}\n`)
    if (result.rules.length === 0) {
      console.log('No specific license rules configured.\n')
      return
    }
    console.log('### Rules\n')
    console.log('| License | Action |')
    console.log('|---------|--------|')
    for (const rule of result.rules) {
      console.log(`| ${rule.license} | ${rule.action} |`)
    }
    return
  }

  // Default table output
  console.log(`Default Action: ${result.defaultAction}\n`)

  if (result.rules.length === 0) {
    console.log('No specific license rules configured.')
    return
  }

  const table = simpleTable({
    headers: ['License', 'Action'],
    rows: result.rules.map(rule => [
      rule.license,
      rule.action,
    ]),
  })

  console.log(table)
}