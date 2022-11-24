/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeverityCount, formatSeverityCount } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { objectSome } from '../../utils/misc.js'
import { setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const info = {
  description: 'Look up info regarding a package',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' info'

    const input = setupCommand(name, info.description, argv, importMeta)
    const packageData = input && await fetchPackageData(input.pkgName, input.pkgVersion, input)

    if (packageData) {
      formatPackageDataOutput(packageData, { name, ...input })
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
  const cli = meow(`
    Usage
      $ ${name} <name>

    Options
      ${printFlagList({
        '--all': 'Include all issues',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
        '--strict': 'Exits with an error code if any matching issues are found',
      }, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags: {
      all: {
        type: 'boolean',
        default: false,
      },
      json: {
        type: 'boolean',
        alias: 'j',
        default: false,
      },
      markdown: {
        type: 'boolean',
        alias: 'm',
        default: false,
      },
      strict: {
        type: 'boolean',
        default: false,
      },
    }
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

  if (versionSeparator < 1) {
    throw new InputError('Need to specify a full package identifier, like eg: webtorrent@1.0.0')
  }

  const pkgName = rawPkgName.slice(0, versionSeparator)
  const pkgVersion = rawPkgName.slice(versionSeparator + 1)

  if (!pkgVersion) {
    throw new InputError('Need to specify a version, like eg: webtorrent@1.0.0')
  }

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
 */

/**
 * @param {string} pkgName
 * @param {string} pkgVersion
 * @param {Pick<CommandContext, 'includeAllIssues' | 'strict'>} context
 * @returns {Promise<void|PackageData>}
 */
async function fetchPackageData (pkgName, pkgVersion, { includeAllIssues, strict }) {
  const socketSdk = await setupSdk()
  const spinner = ora(`Looking up data for version ${pkgVersion} of ${pkgName}`).start()
  const result = await handleApiCall(socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion), spinner, 'looking up package')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(result, spinner)
  }

  // Conclude the status of the API call

  const severityCount = getSeverityCount(result.data, includeAllIssues ? undefined : 'high')

  if (objectSome(severityCount)) {
    const issueSummary = formatSeverityCount(severityCount)
    spinner[strict ? 'fail' : 'succeed'](`Package has these issues: ${issueSummary}`)
  } else {
    spinner.succeed('Package has no issues')
  }

  return {
    data: result.data,
    severityCount,
  }
}

/**
 * @param {PackageData} packageData
 * @param {{ name: string } & CommandContext} context
 * @returns {void}
 */
 function formatPackageDataOutput ({ data, severityCount }, { name, outputJson, outputMarkdown, pkgName, pkgVersion, strict }) {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ChalkOrMarkdown(!!outputMarkdown)
    const url = `https://socket.dev/npm/package/${pkgName}/overview/${pkgVersion}`

    console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true }))
    if (!outputMarkdown) {
      console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
    }
  }

  if (strict && objectSome(severityCount)) {
    process.exit(1)
  }
}
