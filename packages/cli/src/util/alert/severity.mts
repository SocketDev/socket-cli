/**
 * @file Alert severity utilities for Socket CLI security scanning.
 */

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'

import { createEnum, pick } from '../data/objects.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

export const ALERT_SEVERITY = createEnum({
  critical: 'critical',
  high: 'high',
  middle: 'middle',
  low: 'low',
})

export type SocketSdkAlertList =
  SocketSdkSuccessResult<'getIssuesByNPMPackage'>['data']

type SocketSdkAlert = SocketSdkAlertList[number]['value'] extends
  | (infer U)
  | undefined
  ? U
  : never

// Ordered from most severe to least.
export const ALERT_SEVERITIES_SORTED: ReadonlyArray<
  SocketSdkAlert['severity']
> = Object.freeze(['critical', 'high', 'middle', 'low'])

export function formatSeverityCount(
  severityCount: Record<SocketSdkAlert['severity'], number>,
): string {
  const summary: string[] = []
  for (let i = 0, { length } = ALERT_SEVERITIES_SORTED; i < length; i += 1) {
    const severity = ALERT_SEVERITIES_SORTED[i]!
    if (severityCount[severity]) {
      summary.push(`${severityCount[severity]} ${severity}`)
    }
  }
  return joinAnd(summary)
}

export function getDesiredSeverities(
  lowestToInclude: SocketSdkAlert['severity'] | undefined,
): Array<SocketSdkAlert['severity']> {
  const result: Array<SocketSdkAlert['severity']> = []
  for (let i = 0, { length } = ALERT_SEVERITIES_SORTED; i < length; i += 1) {
    const severity = ALERT_SEVERITIES_SORTED[i]!
    result.push(severity)
    if (severity === lowestToInclude) {
      break
    }
  }
  return result
}

export function getSeverityCount(
  issues: SocketSdkAlertList,
  lowestToInclude: SocketSdkAlert['severity'] | undefined,
): Record<SocketSdkAlert['severity'], number> {
  const severityCount = pick(
    { low: 0, middle: 0, high: 0, critical: 0 },
    getDesiredSeverities(lowestToInclude),
  ) as Record<SocketSdkAlert['severity'], number>

  for (let i = 0, { length } = issues; i < length; i += 1) {
    const issue = issues[i]!
    const { value } = issue
    if (!value) {
      continue
    }
    const { severity } = value
    if (severityCount[severity] !== undefined) {
      severityCount[severity] += 1
    }
  }
  return severityCount
}
