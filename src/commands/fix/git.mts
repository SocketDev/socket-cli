import { joinAnd } from '@socketsecurity/registry/lib/arrays'

import constants from '../../constants.mts'

import type { GhsaDetails } from '../../utils/github.mts'

const GITHUB_ADVISORIES_URL = 'https://github.com/advisories'

export type SocketFixBranchParser = (
  branch: string,
) => SocketFixBranchParseResult | null

export type SocketFixBranchParseResult = {
  ghsaId: string
}

export function createSocketFixBranchParser(
  ghsaId?: string | undefined,
): SocketFixBranchParser {
  const pattern = getSocketFixBranchPattern(ghsaId)
  return function parse(branch: string): SocketFixBranchParseResult | null {
    const match = pattern.exec(branch) as [string, string] | null
    if (!match) {
      return null
    }
    const { 1: ghsaId } = match
    return { ghsaId } as SocketFixBranchParseResult
  }
}

export const genericSocketFixBranchParser = createSocketFixBranchParser()

export function getSocketFixBranchName(ghsaId: string): string {
  return `socket/fix/${ghsaId}`
}

export function getSocketFixBranchPattern(ghsaId?: string | undefined): RegExp {
  return new RegExp(`^socket/fix/(${ghsaId ?? '.+'})$`)
}

export function getSocketFixCommitMessage(
  ghsaId: string,
  details?: GhsaDetails | undefined,
): string {
  const summary = details?.summary
  return `fix: ${ghsaId}${summary ? ` - ${summary}` : ''}`
}

export function getSocketFixPullRequestBody(
  ghsaIds: string[],
  ghsaDetails?: Map<string, GhsaDetails>,
): string {
  const vulnCount = ghsaIds.length
  if (vulnCount === 1) {
    const ghsaId = ghsaIds[0]!
    const details = ghsaDetails?.get(ghsaId)
    const body = `[Socket](${constants.SOCKET_WEBSITE_URL}) fix for [${ghsaId}](${GITHUB_ADVISORIES_URL}/${ghsaId}).`
    if (!details) {
      return body
    }
    const packages = details.vulnerabilities.nodes.map(
      v => `${v.package.name} (${v.package.ecosystem})`,
    )
    return [
      body,
      '',
      '',
      `**Vulnerability Summary:** ${details.summary}`,
      '',
      `**Severity:** ${details.severity}`,
      '',
      `**Affected Packages:** ${joinAnd(packages)}`,
    ].join('\n')
  }
  return [
    `[Socket](${constants.SOCKET_WEBSITE_URL}) fixes for ${vulnCount} GHSAs.`,
    '',
    '**Fixed Vulnerabilities:**',
    ...ghsaIds.map(id => {
      const details = ghsaDetails?.get(id)
      const item = `- [${id}](${GITHUB_ADVISORIES_URL}/${id})`
      if (details) {
        const packages = details.vulnerabilities.nodes.map(
          v => `${v.package.name}`,
        )
        return `${item} - ${details.summary} (${joinAnd(packages)})`
      }
      return item
    }),
  ].join('\n')
}

export function getSocketFixPullRequestTitle(ghsaIds: string[]): string {
  const vulnCount = ghsaIds.length
  return vulnCount === 1
    ? `Fix for ${ghsaIds[0]}`
    : `Fixes for ${vulnCount} GHSAs`
}
