/* eslint-disable no-console */
import chalk from 'chalk'
// @ts-ignore
import Table from 'cli-table3'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { InputError } from '../../utils/errors.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const auditlog = {
  description: 'Look up the audit log for an organization',
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' audit-log'

    const input = setupCommand(name, auditlog.description, argv, importMeta)
    if (input) {
      const spinner = ora(`Looking up audit log for ${input.orgSlug}\n`).start()
      await fetchOrgAuditLog(input.orgSlug, input, spinner)
    }
  }
}

const auditLogFlags = prepareFlags({
    type: {
      type: 'string',
      shortFlag: 't',
      default: '',
      description: 'Type of audit log',
    },
    perPage: {
      type: 'number',
      shortFlag: 'pp',
      default: 30,
      description: 'Results per page - default is 30',
    },
    page: {
      type: 'number',
      shortFlag: 'p',
      default: 1,
      description: 'Page number - default is 1',
    }
  })

// Internal functions

/**
 * @typedef CommandContext
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} type
 * @property {number} page
 * @property {number} perPage
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
    ...auditLogFlags,
    ...outputFlags
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
    type,
    page,
    perPage

  } = cli.flags

  if (cli.input.length < 1) {
    throw new InputError('Please provide an organization slug')
  }

  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    cli.showHelp()
    return
  }

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    type,
    page,
    perPage
  }
}

/**
 * @typedef AuditLogData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getAuditLogEvents'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandContext} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|AuditLogData>}
 */
async function fetchOrgAuditLog (orgSlug, input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
  console.log(input)
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getAuditLogEvents(orgSlug, input), 'looking up package')

  if (!result.success) {
    // @ts-ignore
    return handleUnsuccessfulApiResponse('getAuditLogEvents', result, spinner)
  }
  spinner.stop()

  console.log(`\n Audit log for: ${orgSlug} \n`)

  const table = new Table({
    chars: { 'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗', 'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝', 'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼', 'right': '║', 'right-mid': '╢', 'middle': '│' },
    colWidths: [11, 20],
    style: { head: [], border: [] },
    wordWrap: true
  })

  table.push([chalk.magenta('Date'), chalk.magenta('User'), chalk.magenta('Type'), chalk.magenta('IP address'), chalk.magenta('User agent')])

  result.data.results.map((/** @type {{ created_at: string | number | Date; user_email: any; type: any; ip_address: any; user_agent: string; }} */ d) => {
    const data = [
      d.created_at ? new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '',
      d.user_email,
      d.type,
      d.ip_address,
      d.user_agent.split(';').join('\n')
    ]
    return table.push(data)
  })

  console.log(table.toString())

  return {
    data: result.data
  }
}
