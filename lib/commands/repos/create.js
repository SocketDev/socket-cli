// @ts-nocheck
/* eslint-disable no-console */

// import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
// import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
// import { getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const create = {
  description: 'Create a repository in an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' create'

    const input = setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const spinnerText = 'Creating repository... \n'
      const spinner = ora(spinnerText).start()
      await createRepo(input.orgSlug, input, spinner)
    }
  }
}

const listFullScanFlags = prepareFlags({
  sort: {
    type: 'string',
    shortFlag: 's',
    default: 'created_at',
    description: 'Sorting option (`name` or `created_at`) - default is `created_at`',
  },
  direction: {
    type: 'string',
    shortFlag: 'd',
    default: 'desc',
    description: 'Direction option (`desc` or `asc`) - Default is `desc`',
  },
  perPage: {
    type: 'number',
    shortFlag: 'pp',
    default: 30,
    description: 'Results per page - Default is 30',
  },
  page: {
    type: 'number',
    shortFlag: 'p',
    default: 1,
    description: 'Page number - Default is 1',
  },
  fromTime: {
    type: 'string',
    shortFlag: 'f',
    default: '',
    description: 'From time - as a unix timestamp',
  },
  untilTime: {
    type: 'string',
    shortFlag: 'u',
    default: '',
    description: 'Until time - as a unix timestamp',
  }
})

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} sort
 * @property {string} direction
 * @property {number} perPage
 * @property {number} page
 * @property {string} fromTime
 * @property {string} untilTime
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
    ...listFullScanFlags
  }

  const cli = meow(`
    Usage
      $ ${name} <org slug>

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
    sort,
    direction,
    perPage,
    page,
    fromTime,
    untilTime
  } = cli.flags

  if (!cli.input[0]) {
    throw new InputError(`Please specify an organization slug. \n
Example:
socket scan list FakeOrg
`)
  }

  const orgSlug = cli.input[0] || ''

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    sort,
    direction,
    perPage,
    page,
    fromTime,
    untilTime
  }
}

/**
 * @typedef FullScansData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getOrgFullScanList'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|FullScansData>}
 */
async function createRepo (orgSlug, input, spinner) {
  // const socketSdk = await setupSdk(getDefaultKey())
  console.log(input)

//   return {
//     // data: result.data
//   }
}
