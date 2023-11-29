/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeverityCount, formatSeverityCount } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { objectSome } from '../../utils/misc.js'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const info = {
  description: 'Look up info regarding a package',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' info'

    const input = setupCommand(name, info.description, argv, importMeta)
    if (input) {
      const spinnerText = input.pkgVersion === 'latest' ? `Looking up data for the latest version of ${input.pkgName}\n` : `Looking up data for version ${input.pkgVersion} of ${input.pkgName}\n`
      const spinner = ora(spinnerText).start()
      const packageData = await fetchPackageData(input.pkgName, input.pkgVersion, input, spinner)
      if (packageData) {
        formatPackageDataOutput(packageData, { name, ...input }, spinner)
      }
    }
  }
}

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} includeAllIssues
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} pkgName
 * @property {string} pkgVersion
 * @property {boolean} strict
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void|CommandContext}
 */
function setupCommand (name, description, argv, importMeta) {
  const flags = {
    ...outputFlags,
    ...validationFlags,
  }

  const cli = meow(`
    Usage
      $ ${name} <name>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }

  const [rawPkgName = ''] = cli.input

  if (!rawPkgName) {
    cli.showHelp()
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')

  const pkgName = versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion = versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

  return {
    includeAllIssues,
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion,
    strict,
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>["data"]} data
 * @property {Record<import('../../utils/format-issues').SocketIssue['severity'], number>} severityCount
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getScoreByNPMPackage'>["data"]} score
 */

/**
 * @param {string} pkgName
 * @param {string} pkgVersion
 * @param {Pick<CommandContext, 'includeAllIssues'>} context
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function fetchPackageData (pkgName, pkgVersion, { includeAllIssues }, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
  const result = await handleApiCall(socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion), 'looking up package')
  const scoreResult = await handleApiCall(socketSdk.getScoreByNPMPackage(pkgName, pkgVersion), 'looking up package score')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getIssuesByNPMPackage', result, spinner)
  }

  if (scoreResult.success === false) {
    return handleUnsuccessfulApiResponse('getScoreByNPMPackage', scoreResult, spinner)
  }

  // Conclude the status of the API call
  const severityCount = getSeverityCount(result.data, includeAllIssues ? undefined : 'high')

  return {
    data: result.data,
    severityCount,
    score: scoreResult.data
  }
}

/**
 * @param {PackageData} packageData
 * @param {{ name: string } & CommandContext} context
 * @param {import('ora').Ora} spinner
 * @returns {void}
 */
 function formatPackageDataOutput ({ data, severityCount, score }, { name, outputJson, outputMarkdown, pkgName, pkgVersion, strict }, spinner) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    console.log('\nPackage report card:')
    const scoreResult = {
      'Supply Chain Risk': Math.floor(score.supplyChainRisk.score * 100),
      'Maintenance': Math.floor(score.maintenance.score * 100),
      'Quality': Math.floor(score.quality.score * 100),
      'Vulnerabilities': Math.floor(score.vulnerability.score * 100),
      'License': Math.floor(score.license.score * 100)
    }
    Object.entries(scoreResult).map(score => console.log(`- ${score[0]}: ${formatScore(score[1])}`))

    // Package issues list
    if (objectSome(severityCount)) {
      const issueSummary = formatSeverityCount(severityCount)
      console.log('\n')
      spinner[strict ? 'fail' : 'succeed'](`Package has these issues: ${issueSummary}`)
      formatPackageIssuesDetails(data, outputMarkdown)
    } else {
      console.log('\n')
      spinner.succeed('Package has no issues')
    }

    // Link to issues list
    const format = new ChalkOrMarkdown(!!outputMarkdown)
    const url = `https://socket.dev/npm/package/${pkgName}/overview/${pkgVersion}`
    if (pkgVersion === 'latest') {
      console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${pkgName}`, url, { fallbackToUrl: true }))
    } else {
      console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true }))
    }
    if (!outputMarkdown) {
      console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
    }
  }

  if (strict && objectSome(severityCount)) {
    process.exit(1)
  }
}

/**
 * @param {import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>["data"]} packageData
 * @param {boolean} outputMarkdown
 * @returns {void[]}
 */
function formatPackageIssuesDetails (packageData, outputMarkdown) {
  const issueDetails = packageData.filter(d => d.value?.severity === 'high' || d.value?.severity === 'critical')

  const uniqueIssues = issueDetails.reduce((/** @type {{ [key: string]: {count: Number, label: string | undefined} }} */ acc, issue) => {
  const { type } = issue
    if (type) {
      if (!acc[type]) {
        acc[type] = {
          label: issue.value?.label,
          count: 1
        }
      } else {
        // @ts-ignore
        acc[type].count += 1
      }
    }
    return acc
  }, {})

  const format = new ChalkOrMarkdown(!!outputMarkdown)
  return Object.keys(uniqueIssues).map(issue => {
    const issueWithLink = format.hyperlink(`${uniqueIssues[issue]?.label}`, `https://socket.dev/npm/issue/${issue}`, { fallbackToUrl: true })
    if (uniqueIssues[issue]?.count === 1) {
      return console.log(`- ${issueWithLink}`)
    }
    return console.log(`- ${issueWithLink}: ${uniqueIssues[issue]?.count}`)
  })
}

/**
 * @param {number} score
 * @returns {string}
 */
function formatScore (score) {
  const error = chalk.hex('#de7c7b')
  const warning = chalk.hex('#e59361')
  const success = chalk.hex('#a4cb9d')

  if (score > 80) {
    return `${success(score)}`
  } else if (score < 80 && score > 60) {
    return `${warning(score)}`
  } else {
    return `${error(score)}`
  }
}
