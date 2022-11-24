/** @typedef {import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>['data']} SocketIssueList */
/** @typedef {SocketIssueList[number]['value'] extends infer U | undefined ? U : never} SocketIssue */

import { pick, stringJoinWithSeparateFinalSeparator } from './misc.js'

const SEVERITIES_BY_ORDER = /** @type {const} */ ([
  'critical',
  'high',
  'middle',
  'low',
])

/**
 * @param {SocketIssue['severity']|undefined} lowestToInclude
 * @returns {Array<SocketIssue['severity']>}
 */
 function getDesiredSeverities (lowestToInclude) {
  /** @type {Array<SocketIssue['severity']>} */
  const result = []

  for (const severity of SEVERITIES_BY_ORDER) {
    result.push(severity)
    if (severity === lowestToInclude) {
      break
    }
  }

  return result
}

/**
 * @param {SocketIssueList} issues
 * @param {SocketIssue['severity']} [lowestToInclude]
 * @returns {Record<SocketIssue['severity'], number>}
 */
export function getSeverityCount (issues, lowestToInclude) {
  const severityCount = pick(
    { low: 0, middle: 0, high: 0, critical: 0 },
    getDesiredSeverities(lowestToInclude)
  )

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
 * @param {Record<SocketIssue['severity'], number>} severityCount
 * @returns {string}
 */
export function formatSeverityCount (severityCount) {
  /** @type {string[]} */
  const summary = []

  for (const severity of SEVERITIES_BY_ORDER) {
    if (severityCount[severity]) {
      summary.push(`${severityCount[severity]} ${severity}`)
    }
  }

  return stringJoinWithSeparateFinalSeparator(summary)
}
