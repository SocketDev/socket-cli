// @ts-nocheck
/* eslint-disable no-console */
import { Separator } from '@inquirer/select'
import chalk from 'chalk'
import inquirer from 'inquirer'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../../flags/index.js'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api-helpers.js'
import { prepareFlags } from '../../utils/flags.js'
import { printFlagList } from '../../utils/formatting.js'
import { FREE_API_KEY, getDefaultKey, setupSdk } from '../../utils/sdk.js'

/** @type {import('../../utils/meow-with-subcommands.js').CliSubcommand} */
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
      description: 'Type of log event',
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
 * @typedef CommandInput
 * @property {boolean} outputJson
 * @property {boolean} outputMarkdown
 * @property {string} orgSlug
 * @property {string} type
 * @property {number} page
 * @property {number} per_page
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
    console.error(`${chalk.bgRed('Input error')}: Please provide an organization slug \n`)
    cli.showHelp()
    return
  }
  const [orgSlug = ''] = cli.input

  return {
    outputJson,
    outputMarkdown,
    orgSlug,
    type: type && type.charAt(0).toUpperCase() + type.slice(1),
    page,
    per_page: perPage
  }
}

/**
 * @typedef AuditLogData
 * @property {import('@socketsecurity/sdk').SocketSdkReturnType<'getAuditLogEvents'>["data"]} data
 */

/**
 * @param {string} orgSlug
 * @param {CommandInput} input
 * @param {import('ora').Ora} spinner
 * @returns {Promise<void|AuditLogData>}
 */
async function fetchOrgAuditLog (orgSlug, input, spinner) {
  const socketSdk = await setupSdk(getDefaultKey() || FREE_API_KEY)
  // @ts-ignore
  const result = await handleApiCall(socketSdk.getAuditLogEvents(orgSlug, input), 'looking up package')

  if (!result.success) {
    // @ts-ignore
    return handleUnsuccessfulApiResponse('getAuditLogEvents', result, spinner)
  }
  spinner.stop()

  const /** @type {({name: string} | Separator)[]} */ data = []
  const /** @type {{[key: string]: string}} */ logDetails = {}

  result.data.results.map(d => {
    data.push({
      name: `${d.created_at && new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'numeric', day: 'numeric' })} - ${d.user_email} - ${d.type} - ${d.ip_address} - ${d.user_agent}`
    }, new Separator())

    logDetails[`${d.created_at && new Date(d.created_at).toLocaleDateString('en-us', { year: 'numeric', month: 'numeric', day: 'numeric' })} - ${d.user_email} - ${d.type} - ${d.ip_address} - ${d.user_agent}`] = JSON.stringify(d.payload)
    return data
  })

  inquirer
  .prompt(
    {
      type: 'list',
      name: 'log',
      message: input.type ? `\n Audit log for: ${orgSlug} with type: ${input.type} \n` : `\n Audit log for: ${orgSlug} \n`,
      choices: data,
      pageSize: 30
    }
  )
  .then((/** @type {{log: string}} */ answers) => console.log(logDetails[answers.log]))

  return {
    data: result.data
  }
}
