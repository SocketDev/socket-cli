/**
 * @fileoverview Output organization security policy in various formats.
 */

import { simpleTable } from '../../utils/simple-output.mts'

import type { SecurityPolicyResult } from './fetch-security-policy.mts'
import type { OutputKind } from '../../types.mts'

/**
 * Output organization security policy in the specified format.
 */
export function outputSecurityPolicy(
  result: SecurityPolicyResult,
  outputKind: OutputKind,
): void {
  if (outputKind === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (outputKind === 'markdown') {
    console.log('## Security Policy\n')
    console.log(`**Block on Violation**: ${result.blockOnViolation ? 'Yes' : 'No'}\n`)
    if (result.rules.length === 0) {
      console.log('No security rules configured.\n')
      return
    }
    console.log('### Rules\n')
    console.log('| Category | Enabled | Severity |')
    console.log('|----------|---------|----------|')
    for (const rule of result.rules) {
      console.log(
        `| ${rule.category} | ${rule.enabled ? 'Yes' : 'No'} | ${rule.severity} |`
      )
    }
    return
  }

  // Default table output
  console.log(`Block on Violation: ${result.blockOnViolation ? 'Yes' : 'No'}\n`)

  if (result.rules.length === 0) {
    console.log('No security rules configured.')
    return
  }

  const table = simpleTable({
    headers: ['Category', 'Enabled', 'Severity'],
    rows: result.rules.map(rule => [
      rule.category,
      rule.enabled ? 'Yes' : 'No',
      rule.severity,
    ]),
  })

  console.log(table)
}