import path from 'node:path'
import process from 'node:process'

import { logger } from '@socketsecurity/registry/lib/logger'

import { createReport } from './create-report'
import { getSocketConfig } from './get-socket-config'
import { viewReport } from './view-report'
import constants from '../../constants'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { ColorOrMarkdown } from '../../utils/color-or-markdown'
import { meowOrExit } from '../../utils/meow-with-subcommands'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'create',
  description: '[Deprecated] Create a project report',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags,
    dryRun: {
      type: 'boolean',
      default: false,
      description: 'Only output what will be done without actually doing it'
    },
    view: {
      type: 'boolean',
      shortFlag: 'v',
      default: false,
      description: 'Will wait for and return the created report'
    }
  },
  help: () => `
    This command is deprecated in favor of \`socket scan create\`.
    It will be removed in the next major release of the CLI.
  `
}

export const cmdReportCreate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  // TODO: Allow setting a custom cwd and/or configFile path?
  const cwd = process.cwd()
  const absoluteConfigPath = path.join(cwd, 'socket.yml')

  const dryRun = Boolean(cli.flags['dryRun'])
  const json = Boolean(cli.flags['json'])
  const markdown = Boolean(cli.flags['markdown'])
  const strict = Boolean(cli.flags['strict'])
  const includeAllIssues = Boolean(cli.flags['all'])
  const view = Boolean(cli.flags['view'])

  // Note exiting earlier to skirt a hidden auth requirement
  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  const socketConfig = await getSocketConfig(absoluteConfigPath)

  const result = await createReport(socketConfig, cli.input, { cwd, dryRun })

  const commandName = `${parentName} ${config.commandName}`

  if (result?.success) {
    if (view) {
      const reportId = result.data.id
      await viewReport(reportId, {
        all: includeAllIssues,
        commandName,
        json,
        markdown,
        strict
      })
    } else if (json) {
      logger.log(JSON.stringify(result.data, undefined, 2))
    } else {
      const format = new ColorOrMarkdown(markdown)
      logger.log(
        `New report: ${format.hyperlink(result.data.id, result.data.url, { fallbackToUrl: true })}`
      )
    }
  }
}
