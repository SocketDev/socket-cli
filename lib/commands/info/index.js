/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { prepareFlags } from '../../utils/flags.js'
import { formatSeverityCount, getCountSeverity } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { objectSome } from '../../utils/misc.js'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const info = {
  description: 'Look up info regarding a package',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' info'

    const input = setupCommand(name, info.description, argv, importMeta)
    if (input) {
      const spinnerText = input.pkgVersion === 'latest' ? `Looking up data for the latest version of ${input.pkgName}\n` : `Looking up data for version ${input.pkgVersion} of ${input.pkgName}\n`
      const spinner = ora(spinnerText).start()
      const packageData = await fetchPackageData(input.ecosystem, input.pkgName, input.pkgVersion, input, spinner)
      if (packageData) {
        formatPackageDataOutput(packageData, { name, ...input }, spinner)
      }
    }
  }
}

const infoFlags = prepareFlags({
  license: {
    type: 'boolean',
    shortFlag: 'l',
    default: false,
    description: 'Include license - Default is false',
  },
  alerts: {
    type: 'boolean',
    shortFlag: 'a',
    default: false,
    description: 'Include alerts - Default is false',
  }
})

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} includeAlerts
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} pkgName
 * @property {string} pkgVersion
 * @property {boolean} strict
 * @property {string} ecosystem
 * @property {boolean} includeLicense
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
    ...infoFlags
  }

  const cli = meow(`
    Usage
      $ ${name} <ecosystem> <name>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} npm webtorrent
      $ ${name} npm webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    alerts: includeAlerts,
    license: includeLicense,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  const [ecosystem = '', rawPkgName = ''] = cli.input

  if (!ecosystem && !rawPkgName) {
    console.error('Please provide an ecosystem and a package name')
    cli.showHelp()
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')

  const pkgName = versionSeparator < 1 ? rawPkgName : rawPkgName.slice(0, versionSeparator)
  const pkgVersion = versionSeparator < 1 ? 'latest' : rawPkgName.slice(versionSeparator + 1)

  return {
    includeAlerts,
    includeLicense,
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion,
    strict,
    ecosystem
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'batchPackageFetch'>["data"]} data
 * @property {Record<import('../../utils/format-issues.js').SocketIssue['severity'], number> | undefined} severityCount
 */

/**
 * @param {string} ecosystem
 * @param {string} pkgName
 * @param {string} pkgVersion
 * @param {Pick<CommandContext, 'includeAlerts' | 'includeLicense'>} context
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function fetchPackageData (ecosystem, pkgName, pkgVersion, { includeAlerts, includeLicense }, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
  // @ts-ignore
  const result = await handleApiCall(socketSdk.batchPackageFetch(
    { license: includeLicense.toString(), alerts: includeAlerts.toString() },
    {
        components:
            [{
                'purl': `pkg:${ecosystem}/${pkgName}@${pkgVersion}`
            }]
    }), 'looking up package')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('batchPackageFetch', result, spinner)
  }

  // @ts-ignore
  const severityCount = result.data.alerts && getCountSeverity(result.data.alerts, includeAlerts ? undefined : 'high')

  spinner.stop()

  return {
    data: result.data,
    severityCount
  }
}

/**
 * @param {CommandContext} data
 * @param {{ name: string } & CommandContext} context
 * @param {import('ora').Ora} spinner
 * @returns {void}
 */
function formatPackageDataOutput (/** @type {{ [key: string]: any }} */ { data, severityCount }, { name, outputJson, outputMarkdown, pkgName, pkgVersion, strict }, spinner) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    console.log('\nPackage metrics:')

    const scoreResult = {
      'Supply Chain Risk': Math.floor(data.score.supplyChain * 100),
      'Maintenance': Math.floor(data.score.maintenance * 100),
      'Quality': Math.floor(data.score.quality * 100),
      'Vulnerabilities': Math.floor(data.score.vulnerability * 100),
      'License': Math.floor(data.score.license * 100),
      'Overall': Math.floor(data.score.overall * 100)
    }
    Object.entries(scoreResult).map(score => console.log(`- ${score[0]}: ${formatScore(score[1])}`))

    // Package license
    console.log('\nPackage license:')
    console.log(`${data.license}`)

    // Package issues list
    if (objectSome(severityCount)) {
      const issueSummary = formatSeverityCount(severityCount)
      console.log('\n')
      spinner[strict ? 'fail' : 'succeed'](`Package has these issues: ${issueSummary}`)
      formatPackageIssuesDetails(data.alerts, outputMarkdown)
    } else if (severityCount && !objectSome(severityCount)) {
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
 * @param {{[key: string]: any}[]} alertsData
 * @param {boolean} outputMarkdown
 * @returns {void[]}
 */
function formatPackageIssuesDetails (alertsData, outputMarkdown) {
  const issueDetails = alertsData.filter(d => d['severity'] === 'high' || d['severity'] === 'critical')

  const uniqueIssues = issueDetails.reduce((/** @type {{ [key: string]: {count: Number, label: string | undefined} }} */ acc, issue) => {
  const { type } = issue
    if (type) {
      if (!acc[type]) {
        acc[type] = {
          label: issue['type'],
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
