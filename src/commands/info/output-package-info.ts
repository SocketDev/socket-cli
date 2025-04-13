import { codeBlock } from 'common-tags'
import colors from 'yoctocolors-cjs'

import constants from '@socketsecurity/registry/lib/constants'
import { logger } from '@socketsecurity/registry/lib/logger'
import { hasKeys } from '@socketsecurity/registry/lib/objects'

import { ALERT_SEVERITY, formatSeverityCount } from '../../utils/alert/severity'
import { ColorOrMarkdown } from '../../utils/color-or-markdown'
import {
  getSocketDevAlertUrl,
  getSocketDevPackageOverviewUrl
} from '../../utils/socket-url'

import type { PackageData } from './handle-package-info'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { NPM } = constants

function formatScore(score: number): string {
  if (score > 80) {
    return colors.green(`${score}`)
  } else if (score < 80 && score > 60) {
    return colors.yellow(`${score}`)
  }
  return colors.red(`${score}`)
}

function outputPackageIssuesDetails(
  packageData: SocketSdkReturnType<'getIssuesByNPMPackage'>['data'],
  outputMarkdown: boolean
) {
  const issueDetails = packageData.filter(
    d =>
      d.value?.severity === ALERT_SEVERITY.critical ||
      d.value?.severity === ALERT_SEVERITY.high
  )
  const uniqueIssueDetails = issueDetails.reduce((acc, issue) => {
    const { type } = issue
    if (type) {
      const details = acc.get(type)
      if (details) {
        details.count += 1
      } else {
        acc.set(type, {
          label: issue.value?.label ?? '',
          count: 1
        })
      }
    }
    return acc
  }, new Map<string, { count: number; label: string }>())
  const format = new ColorOrMarkdown(outputMarkdown)
  for (const [type, details] of uniqueIssueDetails.entries()) {
    const issueWithLink = format.hyperlink(
      details.label,
      getSocketDevAlertUrl(type),
      { fallbackToUrl: true }
    )
    if (details.count === 1) {
      logger.log(`- ${issueWithLink}`)
    } else {
      logger.log(`- ${issueWithLink}: ${details.count}`)
    }
  }
}

export function outputPackageInfo(
  { data, score, severityCount }: PackageData,
  {
    commandName,
    outputKind,
    pkgName,
    pkgVersion
  }: {
    commandName: string
    outputKind: 'json' | 'markdown' | 'print'
    pkgName: string
    pkgVersion: string
    includeAllIssues?: boolean | undefined
  }
): void {
  if (outputKind === 'json') {
    logger.log(JSON.stringify(data, undefined, 2))
    return
  }
  if (outputKind === 'markdown') {
    logger.log(codeBlock`
      # Package report for ${pkgName}

      Package report card:
    `)
  } else {
    logger.log(`Package report card for ${pkgName}:`)
  }
  const scoreResult = {
    'Supply Chain Risk': Math.floor(score.supplyChainRisk.score * 100),
    Maintenance: Math.floor(score.maintenance.score * 100),
    Quality: Math.floor(score.quality.score * 100),
    Vulnerabilities: Math.floor(score.vulnerability.score * 100),
    License: Math.floor(score.license.score * 100)
  }
  logger.log('\n')
  Object.entries(scoreResult).map(score =>
    logger.log(`- ${score[0]}: ${formatScore(score[1])}`)
  )
  logger.log('\n')
  if (hasKeys(severityCount)) {
    if (outputKind === 'markdown') {
      logger.log('# Issues\n')
    }
    logger.log(
      `Package has these issues: ${formatSeverityCount(severityCount)}\n`
    )
    outputPackageIssuesDetails(data, outputKind === 'markdown')
  } else {
    logger.log('Package has no issues')
  }

  const format = new ColorOrMarkdown(outputKind === 'markdown')
  const url = getSocketDevPackageOverviewUrl(NPM, pkgName, pkgVersion)

  logger.log('\n')
  if (pkgVersion === 'latest') {
    logger.log(
      `Detailed info on socket.dev: ${format.hyperlink(`${pkgName}`, url, { fallbackToUrl: true })}`
    )
  } else {
    logger.log(
      `Detailed info on socket.dev: ${format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true })}`
    )
  }
  if (outputKind !== 'markdown') {
    logger.log(
      colors.dim(
        `\nOr rerun ${colors.italic(commandName)} using the ${colors.italic('--json')} flag to get full JSON output`
      )
    )
  } else {
    logger.log('')
  }
}
