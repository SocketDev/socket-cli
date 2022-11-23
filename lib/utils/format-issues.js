/** @typedef {import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>['data']} SocketIssueList */
/** @typedef {SocketIssueList[number]['value'] extends infer U | undefined ? U : never} SocketIssue */

import { stringJoinWithSeparateFinalSeparator } from './misc.js'

/**
 * @param {SocketIssueList} issues
 * @returns {Record<SocketIssue['severity'], number>}
 */
function getSeverityCount (issues) {
  /** @type {Record<SocketIssue['severity'], number>} */
  const severityCount = { low: 0, middle: 0, high: 0, critical: 0 }

  for (const issue of issues) {
    const value = issue.value

    if (!value) {
      continue
    }

    if (severityCount[value.severity] !== undefined) {
      severityCount[value.severity] += 1
    }
  }

  return severityCount
}

/**
 * @param {SocketIssueList} issues
 * @returns {string}
 */
export function getSeveritySummary (issues) {
  const severityCount = getSeverityCount(issues)

  const issueSummary = stringJoinWithSeparateFinalSeparator([
    severityCount.critical ? severityCount.critical + ' critical' : undefined,
    severityCount.high ? severityCount.high + ' high' : undefined,
    severityCount.middle ? severityCount.middle + ' middle' : undefined,
    severityCount.low ? severityCount.low + ' low' : undefined,
  ])

  return issueSummary
}
