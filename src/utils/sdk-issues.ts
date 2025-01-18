import { pick } from './objects'
import { stringJoinWithSeparateFinalSeparator } from './strings'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type SocketIssueList = SocketSdkReturnType<'getIssuesByNPMPackage'>['data']

export type SocketIssue = SocketIssueList[number]['value'] extends
  | infer U
  | undefined
  ? U
  : never

const SEVERITIES_BY_ORDER: SocketIssue['severity'][] = [
  'critical',
  'high',
  'middle',
  'low'
]

function getDesiredSeverities(
  lowestToInclude: SocketIssue['severity'] | undefined
): SocketIssue['severity'][] {
  const result: SocketIssue['severity'][] = []
  for (const severity of SEVERITIES_BY_ORDER) {
    result.push(severity)
    if (severity === lowestToInclude) {
      break
    }
  }
  return result
}

export function formatSeverityCount(
  severityCount: Record<SocketIssue['severity'], number>
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
  issues: SocketIssueList,
  lowestToInclude: SocketIssue['severity'] | undefined
): Record<SocketIssue['severity'], number> {
  const severityCount = pick(
    { low: 0, middle: 0, high: 0, critical: 0 },
    getDesiredSeverities(lowestToInclude)
  ) as Record<SocketIssue['severity'], number>

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
