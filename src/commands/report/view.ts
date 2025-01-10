import meow from 'meow'
import { ErrorWithCause } from 'pony-cause'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags, validationFlags } from '../../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api-helpers'
import { ColorOrMarkdown } from '../../utils/color-or-markdown'
import { InputError } from '../../utils/errors'
import {
  formatSeverityCount,
  getSeverityCount
} from '../../utils/format-issues'
import { printFlagList } from '../../utils/formatting'
import { setupSdk } from '../../utils/sdk'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

export const view: CliSubcommand = {
  description: 'View a project report',
  async run(
    argv: readonly string[],
    importMeta: ImportMeta,
    { parentName }: { parentName: string }
  ) {
    const name = `${parentName} view`
    const commandContext = setupCommand(
      name,
      view.description,
      argv,
      importMeta
    )
    const result = commandContext
      ? await fetchReportData(commandContext.reportId, commandContext)
      : undefined
    if (result) {
      formatReportDataOutput(result, {
        name,
        ...(<CommandContext>(commandContext ?? {}))
      })
    }
  }
}

// Internal functions

type CommandContext = {
  includeAllIssues: boolean
  outputJson: boolean
  outputMarkdown: boolean
  reportId: string
  strict: boolean
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...validationFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} <report-identifier>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} QXU8PmK7LfH608RAwfIKdbcHgwEd_ZeWJ9QEGv05FJUQ
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  // Extract the input.
  const [reportId, ...extraInput] = cli.input
  let showHelp = cli.flags['help']
  if (reportId) {
    showHelp = true
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  // Validate the input.
  if (extraInput.length) {
    throw new InputError(
      `Can only handle a single report ID at a time, but got ${cli.input.length} report ID:s: ${cli.input.join(', ')}`
    )
  }
  return {
    includeAllIssues: cli.flags['all'],
    outputJson: cli.flags['json'],
    outputMarkdown: cli.flags['markdown'],
    reportId,
    strict: cli.flags['strict']
  } as CommandContext
}
type ReportData = SocketSdkReturnType<'getReport'>['data']

const MAX_TIMEOUT_RETRY = 5

export async function fetchReportData(
  reportId: string,
  {
    includeAllIssues,
    strict
  }: Pick<CommandContext, 'includeAllIssues' | 'strict'>
): Promise<void | ReportData> {
  // Do the API call
  const socketSdk = await setupSdk()
  const spinner = new Spinner({
    text: `Fetching report with ID ${reportId} (this could take a while)`
  }).start()

  let result: SocketSdkResultType<'getReport'> | undefined
  for (let retry = 1; !result; ++retry) {
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await handleApiCall(
        socketSdk.getReport(reportId),
        'fetching report'
      )
    } catch (err) {
      if (
        retry >= MAX_TIMEOUT_RETRY ||
        !(err instanceof ErrorWithCause) ||
        err.cause?.cause?.response?.statusCode !== 524
      ) {
        throw err
      }
    }
  }

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getReport', result, spinner)
  }

  // Conclude the status of the API call

  if (strict) {
    if (result.data.healthy) {
      spinner.success('Report result is healthy and great!')
    } else {
      spinner.error('Report result deemed unhealthy for project')
    }
  } else if (result.data.healthy === false) {
    const severityCount = getSeverityCount(
      result.data.issues,
      includeAllIssues ? undefined : 'high'
    )
    const issueSummary = formatSeverityCount(severityCount)
    spinner.success(`Report has these issues: ${issueSummary}`)
  } else {
    spinner.success('Report has no issues')
  }

  return result.data
}

export function formatReportDataOutput(
  data: ReportData,
  {
    name,
    outputJson,
    outputMarkdown,
    reportId,
    strict
  }: { name: string } & CommandContext
): void {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ColorOrMarkdown(!!outputMarkdown)
    console.log(
      '\nDetailed info on socket.dev: ' +
        format.hyperlink(reportId, data.url, { fallbackToUrl: true })
    )
    if (!outputMarkdown) {
      console.log(
        colors.dim(
          `\nOr rerun ${colors.italic(name)} using the ${colors.italic('--json')} flag to get full JSON output`
        )
      )
    }
  }

  if (strict && data.healthy === false) {
    process.exit(1)
  }
}
