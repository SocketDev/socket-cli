import path from 'node:path'
import process from 'node:process'

import meowOrExit from 'meow'

import { createReport } from './create-report.ts'
import { getSocketConfig } from './get-socket-config.ts'
import { viewReport } from './view-report.ts'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import { ColorOrMarkdown } from '../../utils/color-or-markdown.ts'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'create',
  description: 'Create a project report',
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
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName} <paths-to-package-folders-and-files>

    Uploads the specified "package.json" and lock files for JavaScript, Python, and Go dependency manifests.
    If any folder is specified, the ones found in there recursively are uploaded.

    Supports globbing such as "**/package.json", "**/requirements.txt", "**/pyproject.toml", and "**/go.mod".

    Ignores any file specified in your project's ".gitignore", your project's
    "socket.yml" file's "projectIgnorePaths" and also has a sensible set of
    default ignores from the "ignore-by-default" module.

    Options
      ${getFlagListOutput(config.flags, 6)}

    Examples
      $ ${parentName} ${config.commandName} .
      $ ${parentName} ${config.commandName} '**/package.json'
      $ ${parentName} ${config.commandName} /path/to/a/package.json /path/to/another/package.json
      $ ${parentName} ${config.commandName} . --view --json
  `
}

export const cmdReportCreate = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags,
    allowUnknownFlags: false
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

  const socketConfig = await getSocketConfig(absoluteConfigPath)

  const result = await createReport(socketConfig, cli.input, { cwd, dryRun })

  const commandName = `${parentName} ${config.commandName}`

  if (dryRun && view) {
    console.log(
      '[dryrun] Ignoring view flag since no report was actually generated'
    )
  }
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
      console.log(JSON.stringify(result.data, undefined, 2))
      return
    } else {
      const format = new ColorOrMarkdown(markdown)
      console.log(
        `New report: ${format.hyperlink(result.data.id, result.data.url, { fallbackToUrl: true })}`
      )
    }
  }
}
