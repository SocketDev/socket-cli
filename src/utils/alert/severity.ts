import { pick } from '../objects'
import { stringJoinWithSeparateFinalSeparator } from '../strings'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export type SocketSdkAlertList =
  SocketSdkReturnType<'getIssuesByNPMPackage'>['data']

export type SocketSdkAlert = SocketSdkAlertList[number]['value'] extends
  | infer U
  | undefined
  ? U
  : never

// Ordered from most severe to least.
const SEVERITIES_BY_ORDER: SocketSdkAlert['severity'][] = [
  'critical',
  'high',
  'middle',
  'low'
]

function getDesiredSeverities(
  lowestToInclude: SocketSdkAlert['severity'] | undefined
): SocketSdkAlert['severity'][] {
  const result: SocketSdkAlert['severity'][] = []
  for (const severity of SEVERITIES_BY_ORDER) {
    result.push(severity)
    if (severity === lowestToInclude) {
      break
    }
  }
  return result
}

export function formatSeverityCount(
  severityCount: Record<SocketSdkAlert['severity'], number>
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
  issues: SocketSdkAlertList,
  lowestToInclude: SocketSdkAlert['severity'] | undefined
): Record<SocketSdkAlert['severity'], number> {
  const severityCount = pick(
    { low: 0, middle: 0, high: 0, critical: 0 },
    getDesiredSeverities(lowestToInclude)
  ) as Record<SocketSdkAlert['severity'], number>

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
