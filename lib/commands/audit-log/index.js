// @ts-nocheck
/* eslint-disable no-console */

import chalk from 'chalk'
//@ts-ignore
import chalkTable from 'chalk-table'
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
    markdown: outputMarkdown
  } = cli.flags

  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }

  const [orgSlug = ''] = cli.input

  if (!orgSlug) {
    cli.showHelp()
    return
  }

  return {
    outputJson,
    outputMarkdown,
    orgSlug
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
  const result = await handleApiCall(socketSdk.getAuditLogEvents(orgSlug, input), 'looking up package')

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getAuditLogEvents', result, spinner)
  }
  spinner.stop()

  console.log(`\n Audit log for: ${orgSlug} \n`)

  const options = {
    columns: [
      { field: 'event_id', name: chalk.magenta('Event id') },
      { field: 'country_code', name: chalk.magenta('Country code') },
      { field: 'created_at', name: chalk.magenta('Created at') },
      { field: 'ip_address', name: chalk.magenta('IP address') },
      { field: 'payload', name: chalk.magenta('Payload') },
      { field: 'type', name: chalk.magenta('Type') },
      { field: 'user_agent', name: chalk.magenta('User agent') },
      { field: 'user_id', name: chalk.magenta('User Id') },
      { field: 'user_email', name: chalk.magenta('User email') }
    ]
  }

  const formattedResults = result.data.results.map((/** @type {{ event_id: any; country_code: any; created_at: string | number | Date; }} */ d) => {
    return {
      ...d,
      event_id: d.event_id,
      country_code: chalk.underline(`${d.country_code}`),
      created_at: d.created_at ? new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
    }
  })

  const table = chalkTable(options, formattedResults)
  console.log(table, '\n')

  return {
    data: result.data
  }
}
