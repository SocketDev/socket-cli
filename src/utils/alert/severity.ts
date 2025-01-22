import { pick } from '../objects'
import { stringJoinWithSeparateFinalSeparator } from '../strings'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type SocketAlertList = SocketSdkReturnType<'getIssuesByNPMPackage'>['data']

export type SocketAlert = SocketAlertList[number]['value'] extends
  | infer U
  | undefined
  ? U
  : never

// Ordered from most severe to least.
const SEVERITIES_BY_ORDER: SocketAlert['severity'][] = [
  'critical',
  'high',
  'middle',
  'low'
]

function getDesiredSeverities(
  lowestToInclude: SocketAlert['severity'] | undefined
): SocketAlert['severity'][] {
  const result: SocketAlert['severity'][] = []
  for (const severity of SEVERITIES_BY_ORDER) {
    result.push(severity)
    if (severity === lowestToInclude) {
      break
    }
  }
  return result
}

export function formatSeverityCount(
  severityCount: Record<SocketAlert['severity'], number>
): string {
  const summary: string[] = []
  for (const severity of SEVERITIES_BY_ORDER) {
    if (severityCount[severity]) {
      summary.push(`${severityCount[severity]} ${severity}`)
    }
  }
  return stringJoinWithSeparateFinalSeparator(summary)
}

export function getSeverityCount(
  issues: SocketAlertList,
  lowestToInclude: SocketAlert['severity'] | undefined
): Record<SocketAlert['severity'], number> {
  const severityCount = pick(
    { low: 0, middle: 0, high: 0, critical: 0 },
    getDesiredSeverities(lowestToInclude)
  ) as Record<SocketAlert['severity'], number>

  for (const issue of issues) {
    const { value } = issue
    if (!value) {
      continue
    }
    if (severityCount[value.severity] !== undefined) {
      severityCount[value.severity] += 1
    }
  }
  return severityCount
}
