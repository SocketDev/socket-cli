import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { ChalkOrMarkdown } from '../utils/chalk-markdown'
import { InputError } from '../utils/errors'
import { getSeverityCount, formatSeverityCount } from '../utils/format-issues'
import { printFlagList } from '../utils/formatting'
import { objectSome } from '../utils/objects'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../utils/sdk'

import type { SocketIssue } from '../utils/format-issues'
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { Ora } from 'ora'

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
          ? `Looking up data for the latest version of ${commandContext.pkgName}\n`
          : `Looking up data for version ${commandContext.pkgVersion} of ${commandContext.pkgName}\n`
      const spinner = ora(spinnerText).start()
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
    ...outputFlags,
    ...validationFlags
  }

  const cli = meow(
    `
    Usage
      $ ${name} <name>

    Options
      ${printFlagList(flags, 6)}

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

  const {
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict
  } = cli.flags

  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }

  const { 0: rawPkgName = '' } = cli.input

  if (!rawPkgName) {
    cli.showHelp()
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')

  const pkgName =
    versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion =
    versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

  return {
    includeAllIssues,
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion,
    strict
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
  spinner: Ora
): Promise<void | PackageData> {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
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
  { data, severityCount, score }: PackageData,
  {
    name,
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion,
    strict
  }: CommandContext & { name: string },
  spinner: Ora
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

    if (objectSome(severityCount)) {
      const issueSummary = formatSeverityCount(severityCount)
      console.log('\n')
      spinner[strict ? 'fail' : 'succeed'](
        `Package has these issues: ${issueSummary}`
      )
      formatPackageIssuesDetails(data, outputMarkdown)
    } else {
      console.log('\n')
      spinner.succeed('Package has no issues')
    }

    const format = new ChalkOrMarkdown(!!outputMarkdown)
    const url = `https://socket.dev/npm/package/${pkgName}/overview/${pkgVersion}`
    if (pkgVersion === 'latest') {
      console.log(
        '\nDetailed info on socket.dev: ' +
          format.hyperlink(`${pkgName}`, url, { fallbackToUrl: true })
      )
    } else {
      console.log(
        '\nDetailed info on socket.dev: ' +
          format.hyperlink(`${pkgName} v${pkgVersion}`, url, {
            fallbackToUrl: true
          })
      )
    }
    if (!outputMarkdown) {
      console.log(
        chalk.dim(
          '\nOr rerun',
          chalk.italic(name),
          'using the',
          chalk.italic('--json'),
          'flag to get full JSON output'
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

  const format = new ChalkOrMarkdown(!!outputMarkdown)
  for (const issue of Object.keys(uniqueIssues)) {
    const issueWithLink = format.hyperlink(
      `${uniqueIssues[issue]?.label}`,
      `https://socket.dev/npm/issue/${issue}`,
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
  const error = chalk.hex('#de7c7b')
  const warning = chalk.hex('#e59361')
  const success = chalk.hex('#a4cb9d')

  if (score > 80) {
    return `${success(score)}`
  } else if (score < 80 && score > 60) {
    return `${warning(score)}`
  }
  return `${error(score)}`
}
