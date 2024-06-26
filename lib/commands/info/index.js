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
      const spinnerText = `Looking up data for packages: ${input.packages.join(', ')}\n`
      const spinner = ora(spinnerText).start()
      const packageData = await fetchPackageData(input.packages, input.includeAlerts, spinner)
      if (packageData) {
        formatPackageDataOutput(packageData, { name, ...input }, spinner)
      }
    }
  }
}

const infoFlags = prepareFlags({
  // At the moment in API v0, alerts and license do the same thing.
  // The license parameter will be implemented later.
  // license: {
  //   type: 'boolean',
  //   shortFlag: 'l',
  //   default: false,
  //   description: 'Include license - Default is false',
  // },
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
 * @property {string[]} packages
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
    ...infoFlags
  }

  const cli = meow(`
    Usage
      $ ${name} <ecosystem>:<name>@<version>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} npm:webtorrent
      $ ${name} npm:webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    alerts: includeAlerts,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  const [rawPkgName = ''] = cli.input

  if (!rawPkgName) {
    console.error('Please provide an ecosystem and package name')
    cli.showHelp()
    return
  }

  const /** @type {string[]} */inputPkgs = []

  cli.input.map(pkg => {
    const ecosystem = pkg.split(':')[0]
    if (!ecosystem) {
      console.error(`Package name ${pkg} formatted incorrectly.`)
      return cli.showHelp()
    } else {
      const versionSeparator = pkg.lastIndexOf('@')
      const ecosystemSeparator = pkg.lastIndexOf(ecosystem)
      const pkgName = versionSeparator < 1 ? pkg.slice(ecosystemSeparator + ecosystem.length + 1) : pkg.slice(ecosystemSeparator + ecosystem.length + 1, versionSeparator)
      const pkgVersion = versionSeparator < 1 ? 'latest' : pkg.slice(versionSeparator + 1)
      inputPkgs.push(`${ecosystem}/${pkgName}@${pkgVersion}`)
    }
    return inputPkgs
  })

  return {
    includeAlerts,
    outputJson,
    outputMarkdown,
    packages: inputPkgs,
    strict,
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'batchPackageFetch'>["data"]} data
 */

/**
 * @param {string[]} packages
 * @param {boolean} includeAlerts
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function fetchPackageData (packages, includeAlerts, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)

  const components = packages.map(pkg => {
    return { 'purl': `pkg:${pkg}` }
  })

  // @ts-ignore
  const result = await handleApiCall(socketSdk.batchPackageFetch(
    { alerts: includeAlerts.toString() },
    {
        components
    }), 'looking up package')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('batchPackageFetch', result, spinner)
  }

  // @ts-ignore
  result.data.map(pkg => {
    const severityCount = pkg.alerts && getCountSeverity(pkg.alerts, includeAlerts ? undefined : 'high')
    pkg.severityCount = severityCount
    return pkg
  })

  spinner.stop()

  return {
    data: result.data
  }
}

/**
 * @param {CommandContext} data
 * @param {{ name: string } & CommandContext} context
 * @param {import('ora').Ora} spinner
 * @returns {void}
 */
function formatPackageDataOutput (/** @type {{ [key: string]: any }} */ { data }, { outputJson, outputMarkdown, strict }, spinner) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    data.map((/** @type {{[key:string]: any}} */ d) => {
      const { score, license, name, severityCount, version } = d
      console.log(`\nPackage metrics for ${name}:`)

      const scoreResult = {
        'Supply Chain Risk': Math.floor(score.supplyChain * 100),
        'Maintenance': Math.floor(score.maintenance * 100),
        'Quality': Math.floor(score.quality * 100),
        'Vulnerabilities': Math.floor(score.vulnerability * 100),
        'License': Math.floor(score.license * 100),
        'Overall': Math.floor(score.overall * 100)
      }

      Object.entries(scoreResult).map(score => console.log(`- ${score[0]}: ${formatScore(score[1])}`))

      // Package license
      console.log('\nPackage license:')
      console.log(`${license}`)

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
      const url = `https://socket.dev/npm/package/${name}/overview/${version}`
      if (version === 'latest') {
        console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${name}`, url, { fallbackToUrl: true }))
      } else {
        console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${name} v${version}`, url, { fallbackToUrl: true }))
      }
      if (!outputMarkdown) {
        console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
      }

      if (strict && objectSome(severityCount)) {
        process.exit(1)
      }
      return d
    })
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
