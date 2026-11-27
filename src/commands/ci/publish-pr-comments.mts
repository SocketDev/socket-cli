import { upsertPullRequestComment } from '../../utils/github.mts'
import type { ReportLeafNode, ScanReport } from '../scan/generate-report.mts'

export const PR_OVERVIEW_COMMENT_MARKER =
  '<!-- socket-overview-comment-actions -->'
export const PR_SECURITY_COMMENT_MARKER =
  '<!-- socket-security-comment-actions -->'

export async function publishPullRequestComments({
  disableOverview,
  disableSecurity,
  overviewBody,
  owner,
  pullRequest,
  repo,
  securityBody,
}: {
  disableOverview: boolean
  disableSecurity: boolean
  overviewBody: string
  owner: string
  pullRequest: number
  repo: string
  securityBody: string
}): Promise<void> {
  if (!disableOverview && overviewBody.trim()) {
    await upsertPullRequestComment({
      body: `${PR_OVERVIEW_COMMENT_MARKER}\n${overviewBody}`,
      marker: PR_OVERVIEW_COMMENT_MARKER,
      owner,
      pullRequest,
      repo,
    })
  }

  if (!disableSecurity && securityBody.trim()) {
    await upsertPullRequestComment({
      body: `${PR_SECURITY_COMMENT_MARKER}\n${securityBody}`,
      marker: PR_SECURITY_COMMENT_MARKER,
      owner,
      pullRequest,
      repo,
    })
  }
}

export function renderPullRequestOverview(report: ScanReport): string {
  const alertCount = collectPullRequestAlertRows(report).length
  return [
    '# Socket dependency overview',
    '',
    `Scan ${report.scanId} found ${alertCount} policy alert${alertCount === 1 ? '' : 's'}.`,
    `Health status: ${report.healthy ? 'pass' : 'fail'}.`,
  ].join('\n')
}

export function renderPullRequestSecurity(report: ScanReport): string {
  const rows = collectPullRequestAlertRows(report)
  return [
    '# Socket security findings',
    '',
    rows.length > 0 ? rows.join('\n') : 'No policy findings remain.',
  ].join('\n')
}

export function collectPullRequestAlertRows(report: ScanReport): string[] {
  const rows: string[] = []
  const pending: Array<{ node: unknown; path: string[] }> = [
    { node: report.alerts, path: [] },
  ]
  while (pending.length > 0) {
    const { node, path } = pending.pop()!
    if (node instanceof Map) {
      for (const [name, child] of node) {
        pending.push({ node: child, path: [...path, String(name)] })
      }
      continue
    }
    if (isReportLeafNode(node)) {
      rows.push(
        `- ${path.join(' / ')}: ${node.type} (${node.policy})${node.url ? ` ${node.url}` : ''}`,
      )
    }
  }
  return rows
}

function isReportLeafNode(node: unknown): node is ReportLeafNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    typeof node.type === 'string' &&
    'policy' in node &&
    typeof node.policy === 'string'
  )
}
