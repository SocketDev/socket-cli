import process from 'node:process'

import meow from 'meow'
import colors from 'yoctocolors-cjs'

import constants from '@socketsecurity/registry/lib/constants'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags, validationFlags } from '../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { ColorOrMarkdown } from '../utils/color-or-markdown'
import { InputError } from '../utils/errors'
import { formatSeverityCount, getSeverityCount } from '../utils/format-issues'
import { getFlagListOutput } from '../utils/formatting'
import { objectSome } from '../utils/objects'
import { getPublicToken, setupSdk } from '../utils/sdk'
import {
  getSocketDevAlertUrl,
  getSocketDevPackageOverviewUrl
} from '../utils/socket-url'

import type { SocketIssue } from '../utils/format-issues'
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const { NPM } = constants

export const info: CliSubcommand = {
  description: 'Look up info regarding a package',
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' info'

    const commandContext = setupCommand(
      name,
      info.description,
      argv,
      importMeta
    )
    if (commandContext) {
      const spinnerText =
        commandContext.pkgVersion === 'latest'
          ? `Looking up data for the latest version of ${commandContext.pkgName}`
          : `Looking up data for version ${commandContext.pkgVersion} of ${commandContext.pkgName}`
      const spinner = new Spinner({ text: spinnerText }).start()
      const packageData = await fetchPackageData(
        commandContext.pkgName,
        commandContext.pkgVersion,
        commandContext,
        spinner
      )
      if (packageData) {
        formatPackageDataOutput(
          packageData,
          { name, ...commandContext },
          spinner
        )
      }
    }
  }
}

// Internal functions

interface CommandContext {
  includeAllIssues: boolean
  outputJson: boolean
  outputMarkdown: boolean
  pkgName: string
  pkgVersion: string
  strict: boolean
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): void | CommandContext {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <name>

    Options
      ${getFlagListOutput(flags, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }
  const { 0: rawPkgName = '' } = cli.input
  let showHelp = cli.flags['help']
  if (!rawPkgName) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const versionSeparator = rawPkgName.lastIndexOf('@')
  const pkgName =
    versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion =
    versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)
  return {
    includeAllIssues: cli.flags['all'],
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    pkgName,
    pkgVersion,
    strict: cli.flags['strict']
  } as CommandContext
}

interface PackageData {
  data: SocketSdkReturnType<'getIssuesByNPMPackage'>['data']
  severityCount: Record<SocketIssue['severity'], number>
  score: SocketSdkReturnType<'getScoreByNPMPackage'>['data']
}

async function fetchPackageData(
  pkgName: string,
  pkgVersion: string,
  { includeAllIssues }: Pick<CommandContext, 'includeAllIssues'>,
  spinner: Spinner
): Promise<void | PackageData> {
  const socketSdk = await setupSdk(getPublicToken())
  const result = await handleApiCall(
    socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion),
    'looking up package'
  )
  const scoreResult = await handleApiCall(
    socketSdk.getScoreByNPMPackage(pkgName, pkgVersion),
    'looking up package score'
  )

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(
      'getIssuesByNPMPackage',
      result,
      spinner
    )
  }

  if (scoreResult.success === false) {
    return handleUnsuccessfulApiResponse(
      'getScoreByNPMPackage',
      scoreResult,
      spinner
    )
  }

  const severityCount = getSeverityCount(
    result.data,
    includeAllIssues ? undefined : 'high'
  )

  return {
    data: result.data,
    severityCount,
    score: scoreResult.data
  }
}

function formatPackageDataOutput(
  { data, score, severityCount }: PackageData,
  {
    name,
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion,
    strict
  }: CommandContext & { name: string },
  spinner: Spinner
): void {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    console.log('\nPackage report card:')
    const scoreResult = {
      'Supply Chain Risk': Math.floor(score.supplyChainRisk.score * 100),
      Maintenance: Math.floor(score.maintenance.score * 100),
      Quality: Math.floor(score.quality.score * 100),
      Vulnerabilities: Math.floor(score.vulnerability.score * 100),
      License: Math.floor(score.license.score * 100)
    }
    Object.entries(scoreResult).map(score =>
      console.log(`- ${score[0]}: ${formatScore(score[1])}`)
    )
    console.log('\n')
    if (objectSome(severityCount)) {
      spinner[strict ? 'error' : 'success'](
        `Package has these issues: ${formatSeverityCount(severityCount)}`
      )
      formatPackageIssuesDetails(data, outputMarkdown)
    } else {
      spinner.success('Package has no issues')
    }

    const format = new ColorOrMarkdown(!!outputMarkdown)
    const url = getSocketDevPackageOverviewUrl(NPM, pkgName, pkgVersion)

    console.log('\n')
    if (pkgVersion === 'latest') {
      console.log(
        `Detailed info on socket.dev: ${format.hyperlink(`${pkgName}`, url, { fallbackToUrl: true })}`
      )
    } else {
      console.log(
        `Detailed info on socket.dev: ${format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true })}`
      )
    }
    if (!outputMarkdown) {
      console.log(
        colors.dim(
          `\nOr rerun ${colors.italic(name)} using the ${colors.italic('--json')} flag to get full JSON output`
        )
      )
    }
  }

  if (strict && objectSome(severityCount)) {
    process.exit(1)
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

  const format = new ColorOrMarkdown(!!outputMarkdown)
  for (const issue of Object.keys(uniqueIssues)) {
    const issueWithLink = format.hyperlink(
      `${uniqueIssues[issue]?.label}`,
      getSocketDevAlertUrl(issue),
      { fallbackToUrl: true }
    )
    if (uniqueIssues[issue]?.count === 1) {
      console.log(`- ${issueWithLink}`)
    } else {
      console.log(`- ${issueWithLink}: ${uniqueIssues[issue]?.count}`)
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
