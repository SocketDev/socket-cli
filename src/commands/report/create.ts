import path from 'node:path'

import { betterAjvErrors } from '@apideck/better-ajv-errors'
import meow from 'meow'
import { ErrorWithCause } from 'pony-cause'

import { SocketValidationError, readSocketConfig } from '@socketsecurity/config'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { fetchReportData, formatReportDataOutput } from './view'
import { commonFlags, outputFlags, validationFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { ColorOrMarkdown, logSymbols } from '../../utils/color-or-markdown'
import { InputError } from '../../utils/errors'
import { getFlagListOutput } from '../../utils/formatting'
import { createDebugLogger } from '../../utils/misc'
import { getPackageFiles } from '../../utils/path-resolve'
import { setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type { SocketYml } from '@socketsecurity/config'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export const create: CliSubcommand = {
  description: 'Create a project report',
  async run(
    argv: readonly string[],
    importMeta: ImportMeta,
    { parentName }: { parentName: string }
  ) {
    const name = `${parentName} create`
    const input = await setupCommand(name, create.description, argv, importMeta)
    if (input) {
      const {
        config,
        cwd,
        debugLog,
        dryRun,
        includeAllIssues,
        outputJson,
        outputMarkdown,
        packagePaths,
        strict,
        view
      } = input

      const result =
        input &&
        (await createReport(packagePaths, { config, cwd, debugLog, dryRun }))

      if (result && view) {
        const reportId = result.data.id
        const reportData =
          input &&
          (await fetchReportData(reportId, { includeAllIssues, strict }))

        if (reportData) {
          formatReportDataOutput(reportData, {
            includeAllIssues,
            name,
            outputJson,
            outputMarkdown,
            reportId,
            strict
          })
        }
      } else if (result) {
        formatReportCreationOutput(result.data, { outputJson, outputMarkdown })
      }
    }
  }
}

// Internal functions

type CommandContext = {
  config: SocketYml | undefined
  cwd: string
  debugLog: typeof console.error
  dryRun: boolean
  includeAllIssues: boolean
  outputJson: boolean
  outputMarkdown: boolean
  packagePaths: string[]
  strict: boolean
  view: boolean
}

async function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): Promise<void | CommandContext> {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags,
    debug: {
      type: 'boolean',
      shortFlag: 'd',
      default: false,
      description: 'Output debug information'
    },
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
  }
  const cli = meow(
    `
    Usage
      $ ${name} <paths-to-package-folders-and-files>

    Uploads the specified "package.json" and lock files for JavaScript, Python, and Go dependency manifests.
    If any folder is specified, the ones found in there recursively are uploaded.

    Supports globbing such as "**/package.json", "**/requirements.txt", "**/pyproject.toml", and "**/go.mod".

    Ignores any file specified in your project's ".gitignore", your project's
    "socket.yml" file's "projectIgnorePaths" and also has a sensible set of
    default ignores from the "ignore-by-default" module.

    Options
      ${getFlagListOutput(
        {
          all: 'Include all issues',
          debug: 'Output debug information',
          'dry-run': 'Only output what will be done without actually doing it',
          json: 'Output result as json',
          markdown: 'Output result as markdown',
          strict: 'Exits with an error code if any matching issues are found',
          view: 'Will wait for and return the created report'
        },
        6
      )}

    Examples
      $ ${name} .
      $ ${name} '**/package.json'
      $ ${name} /path/to/a/package.json /path/to/another/package.json
      $ ${name} . --view --json
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  let showHelp = cli.flags['help']
  if (!cli.input[0]) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  const { dryRun } = cli.flags
  const debugLog = createDebugLogger(!dryRun || (cli.flags['debug'] as boolean))

  // TODO: Allow setting a custom cwd and/or configFile path?
  const cwd = process.cwd()
  const absoluteConfigPath = path.join(cwd, 'socket.yml')

  const config = await readSocketConfig(absoluteConfigPath).catch(
    (cause: unknown) => {
      if (
        cause &&
        typeof cause === 'object' &&
        cause instanceof SocketValidationError
      ) {
        // Inspired by workbox-build:
        // https://github.com/GoogleChrome/workbox/blob/95f97a207fd51efb3f8a653f6e3e58224183a778/packages/workbox-build/src/lib/validate-options.ts#L68-L71
        const betterErrors = betterAjvErrors({
          basePath: 'config',
          data: cause.data,
          errors: cause.validationErrors,
          schema: cause.schema as Parameters<
            typeof betterAjvErrors
          >[0]['schema']
        })
        throw new InputError(
          'The socket.yml config is not valid',
          betterErrors
            .map(
              err =>
                `[${err.path}] ${err.message}.${err.suggestion ? err.suggestion : ''}`
            )
            .join('\n')
        )
      } else {
        throw new ErrorWithCause('Failed to read socket.yml config', { cause })
      }
    }
  )

  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success)
        handleUnsuccessfulApiResponse(
          'getReportSupportedFiles',
          res,
          new Spinner()
        )
      return (res as SocketSdkReturnType<'getReportSupportedFiles'>).data
    })
    .catch((cause: Error) => {
      throw new ErrorWithCause('Failed getting supported files for report', {
        cause
      })
    })

  const packagePaths = await getPackageFiles(
    cwd,
    cli.input,
    config,
    supportedFiles,
    debugLog
  )

  return {
    config,
    cwd,
    debugLog,
    dryRun,
    includeAllIssues: cli.flags['all'],
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    packagePaths,
    strict: cli.flags['strict'],
    view: cli.flags['view']
  } as CommandContext
}

async function createReport(
  packagePaths: string[],
  {
    config,
    cwd,
    debugLog,
    dryRun
  }: Pick<CommandContext, 'config' | 'cwd' | 'debugLog' | 'dryRun'>
): Promise<void | SocketSdkReturnType<'createReport'>> {
  debugLog('Uploading:', packagePaths.join(`\n${logSymbols.info} Uploading: `))

  if (dryRun) {
    return
  }

  const socketSdk = await setupSdk()
  const spinner = new Spinner({
    text: `Creating report with ${packagePaths.length} package files`
  }).start()
  const apiCall = socketSdk.createReportFromFilePaths(
    packagePaths,
    cwd,
    config?.issueRules
  )
  const result = await handleApiCall(apiCall, 'creating report')

  if (result.success) {
    spinner.success()
    return result
  }
  handleUnsuccessfulApiResponse('createReport', result, spinner)
  return undefined
}

function formatReportCreationOutput(
  data: SocketSdkReturnType<'createReport'>['data'],
  {
    outputJson,
    outputMarkdown
  }: Pick<CommandContext, 'outputJson' | 'outputMarkdown'>
): void {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
    return
  }
  const format = new ColorOrMarkdown(!!outputMarkdown)
  console.log(
    `New report: ${format.hyperlink(data.id, data.url, { fallbackToUrl: true })}`
  )
}
