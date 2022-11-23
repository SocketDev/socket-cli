/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { InputError } from '../../utils/errors.js'
import { getSeveritySummary } from '../../utils/format-issues.js'
import { printFlagList } from '../../utils/formatting.js'
import { setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const info = {
  description: 'Look up info regarding a package',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' info'

    const input = setupCommand(name, info.description, argv, importMeta)
    const result = input && await fetchPackageData(input.pkgName, input.pkgVersion)

    if (result) {
      formatPackageDataOutput(result.data, { name, ...input })
    }
  }
}

// Internal functions

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void|{ outputJson: boolean, outputMarkdown: boolean, pkgName: string, pkgVersion: string }}
 */
 function setupCommand (name, description, argv, importMeta) {
  const cli = meow(`
    Usage
      $ ${name} <name>

    Options
      ${printFlagList({
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
      }, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags: {
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
    }
  })

  const {
    json: outputJson,
    markdown: outputMarkdown,
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
    outputJson,
    outputMarkdown,
    pkgName,
    pkgVersion
  }
}

/**
 * @param {string} pkgName
 * @param {string} pkgVersion
 * @returns {Promise<void|import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>>}
 */
async function fetchPackageData (pkgName, pkgVersion) {
  const socketSdk = await setupSdk()
  const spinner = ora(`Looking up data for version ${pkgVersion} of ${pkgName}`).start()
  const result = await handleApiCall(socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion), spinner, 'looking up package')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(result, spinner)
  }

  // Conclude the status of the API call

  const issueSummary = getSeveritySummary(result.data)
  spinner.succeed(`Found ${issueSummary || 'no'} issues for version ${pkgVersion} of ${pkgName}`)

  return result
}

/**
 * @param {import('@socketsecurity/sdk').SocketSdkReturnType<'getIssuesByNPMPackage'>["data"]} data
 * @param {{ name: string, outputJson: boolean, outputMarkdown: boolean, pkgName: string, pkgVersion: string }} context
 * @returns {void}
 */
 function formatPackageDataOutput (data, { name, outputJson, outputMarkdown, pkgName, pkgVersion }) {
  // If JSON, output and return...

  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
    return
  }

  // ...else do the CLI / Markdown output dance

  const format = new ChalkOrMarkdown(!!outputMarkdown)
  const url = `https://socket.dev/npm/package/${pkgName}/overview/${pkgVersion}`

  console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true }))
  if (!outputMarkdown) {
    console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
  }
}
