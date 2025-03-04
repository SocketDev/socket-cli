import colors from 'yoctocolors-cjs'

import constants from '@socketsecurity/registry/lib/constants'
import { logger } from '@socketsecurity/registry/lib/logger'

import { PackageData } from './get-package-info'
import { formatSeverityCount } from '../../utils/alert/severity'
import { ColorOrMarkdown } from '../../utils/color-or-markdown'
import { objectSome } from '../../utils/objects'
import {
  getSocketDevAlertUrl,
  getSocketDevPackageOverviewUrl
} from '../../utils/socket-url'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { NPM } = constants

export function formatPackageInfo(
  { data, score, severityCount }: PackageData,
  {
    name,
    outputKind,
    pkgName,
    pkgVersion
  }: {
    includeAllIssues: boolean
    name: string
    outputKind: 'json' | 'markdown' | 'print'
    pkgName: string
    pkgVersion: string
  }
): void {
  if (outputKind === 'json') {
    logger.log(JSON.stringify(data, undefined, 2))
    return
  }

  if (outputKind === 'markdown') {
    logger.log(`\n# Package report for ${pkgName}\n`)
    logger.log('Package report card:\n')
  } else {
    logger.log(`\nPackage report card for ${pkgName}:\n`)
  }
  const scoreResult = {
    'Supply Chain Risk': Math.floor(score.supplyChainRisk.score * 100),
    Maintenance: Math.floor(score.maintenance.score * 100),
    Quality: Math.floor(score.quality.score * 100),
    Vulnerabilities: Math.floor(score.vulnerability.score * 100),
    License: Math.floor(score.license.score * 100)
  }
  Object.entries(scoreResult).map(score =>
    logger.log(`- ${score[0]}: ${formatScore(score[1])}`)
  )
  logger.log('\n')

  if (objectSome(severityCount)) {
    if (outputKind === 'markdown') {
      logger.log('# Issues\n')
    }
    logger.log(
      `Package has these issues: ${formatSeverityCount(severityCount)}\n`
    )
    formatPackageIssuesDetails(data, outputKind === 'markdown')
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
        `\nOr rerun ${colors.italic(name)} using the ${colors.italic('--json')} flag to get full JSON output`
      )
    )
  } else {
    logger.log('')
  }
}

function formatPackageIssuesDetails(
  packageData: SocketSdkReturnType<'getIssuesByNPMPackage'>['data'],
  outputMarkdown: boolean
) {
  const issueDetails = packageData.filter(
    d => d.value?.severity === 'high' || d.value?.severity === 'critical'
  )

  const uniqueIssues = issueDetails.reduce(
    (
      acc: { [key: string]: { count: number; label: string | undefined } },
      issue
    ) => {
      const { type } = issue
      if (type) {
        if (acc[type] === undefined) {
          acc[type] = {
            label: issue.value?.label,
            count: 1
          }
        } else {
          acc[type]!.count += 1
        }
      }
      return acc
    },
    {}
  )

  const format = new ColorOrMarkdown(outputMarkdown)
  for (const issue of Object.keys(uniqueIssues)) {
    const issueWithLink = format.hyperlink(
      `${uniqueIssues[issue]?.label}`,
      getSocketDevAlertUrl(issue),
      { fallbackToUrl: true }
    )
    if (uniqueIssues[issue]?.count === 1) {
      logger.log(`- ${issueWithLink}`)
    } else {
      logger.log(`- ${issueWithLink}: ${uniqueIssues[issue]?.count}`)
    }
  }
}

function formatScore(score: number): string {
  if (score > 80) {
    return colors.green(`${score}`)
  } else if (score < 80 && score > 60) {
    return colors.yellow(`${score}`)
  }
  return colors.red(`${score}`)
}
