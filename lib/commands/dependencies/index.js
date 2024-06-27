/* eslint-disable no-console */

// import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
export const dependencies = {
  description: 'Search for any dependency that is being used in your organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' dependencies'

    const input = setupCommand(name, dependencies.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Searching dependencies...'
      const spinner = ora(spinnerText).start()
      await searchDeps(input.limit, input.offset, spinner)
    }
  }
}

const dependenciesFlags = prepareFlags({
    limit: {
      type: 'number',
      shortFlag: 'l',
      default: 50,
      description: 'Repository name',
    },
    offset: {
      type: 'number',
      shortFlag: 'o',
      default: 0,
      description: 'Branch name',
    }
  })

// Internal functions

/**
 * @typedef Command
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {number} limit
 * @property {number} offset
 */

/**
 * @param {string} name
 * @param {string} description
 * @param {readonly string[]} argv
 * @param {ImportMeta} importMeta
 * @returns {void|Command}
 */
function setupCommand (name, description, argv, importMeta) {
  const flags = {
    ...outputFlags,
    ...dependenciesFlags
  }

  const cli = meow(`
    Usage
      $ ${name}

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} FakeOrg
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    json: outputJson,
    markdown: outputMarkdown,
    limit,
    offset
  } = cli.flags

//   if (cli.input.length < 2) {
//     console.error(`${chalk.bgRed('Input error')}: Please specify an organization slug and a scan ID.\n`)
//     cli.showHelp()
//     return
//   }

  return {
    outputJson,
    outputMarkdown,
    limit,
    offset
  }
}

/**
 * @typedef DependenciesData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'searchDependencies'>["data"]} data
 */

/**
 * @param {number} limit
 * @param {number} offset
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|DependenciesData>}
 */
async function searchDeps (limit, offset, spinner) {
  const socketSdk = await setupSdk(getDefaultKey())
  // @ts-ignore
  const result = await handleApiCall(socketSdk.searchDependencies({ limit, offset }), 'Searching dependencies')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('searchDependencies', result, spinner)
  }

  spinner.stop()

  console.log('Organization dependencies: \n')
  console.log(result.data)

  return {
    data: result.data
  }
}
