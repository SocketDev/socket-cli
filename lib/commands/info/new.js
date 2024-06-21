/* eslint-disable no-console */

import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const info2 = {
  description: 'Look up info regarding a package',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' info2'

    const input = setupCommand(name, info2.description, argv, importMeta)
    if (input) {
      const spinnerText = input.pkgVersion === 'latest' ? `Looking up data for the latest version of ${input.pkgName}\n` : `Looking up data for version ${input.pkgVersion} of ${input.pkgName}\n`
      const spinner = ora(spinnerText).start()
      await fetchPackageData(input.ecosystem, input.pkgName, input.pkgVersion, spinner)
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
 * @property {string} ecosystem
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
    all: includeAllIssues,
    json: outputJson,
    markdown: outputMarkdown,
    strict,
  } = cli.flags

  if (cli.input.length > 2) {
    throw new InputError('Only one package lookup supported at once')
  }

  const [ecosystem = '', rawPkgName = ''] = cli.input

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
    ecosystem
  }
}

/**
 * @typedef PackageData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'batchPackageFetch'>["data"]} data
 */

/**
 * @param {string} ecosystem
 * @param {string} pkgName
 * @param {string} pkgVersion
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|PackageData>}
 */
async function fetchPackageData (ecosystem, pkgName, pkgVersion, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
  // @ts-ignore
  const result = await handleApiCall(socketSdk.batchPackageFetch(
    { license: false, alerts: false },
    {
        components:
            [{
                'purl': `pkg:${ecosystem}/${pkgName}@${pkgVersion}`
            }]
    }), 'looking up package')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('batchPackageFetch', result, spinner)
  }

  console.log(result.data)

  spinner.stop()

  return {
    data: result.data
  }
}
