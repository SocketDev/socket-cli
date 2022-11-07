/* eslint-disable no-console */

import chalk from 'chalk'
import meow from 'meow'
import ora from 'ora'
import { ErrorWithCause } from 'pony-cause'

import { ChalkOrMarkdown } from '../../utils/chalk-markdown.js'
import { AuthError, InputError } from '../../utils/errors.js'
import { printFlagList } from '../../utils/formatting.js'
import { stringJoinWithSeparateFinalSeparator } from '../../utils/misc.js'
import { setupSdk } from '../../utils/sdk.js'

const description = 'Look up info regarding a package'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommandRun} */
const run = async (argv, importMeta, { parentName }) => {
  const name = parentName + ' info'

  const cli = meow(`
    Usage
      $ ${name} <name>

    Options
      ${printFlagList({
        '--debug': 'Output debug information',
        '--json': 'Output result as json',
        '--markdown': 'Output result as markdown',
      }, 6)}

    Examples
      $ ${name} webtorrent
      $ ${name} webtorrent@1.9.1
  `, {
    argv,
    description,
    importMeta,
    flags: {
      debug: {
        type: 'boolean',
        alias: 'd',
        default: false,
      },
      json: {
        type: 'boolean',
        alias: 'j',
        default: false,
      },
      markdown: {
        type: 'boolean',
        alias: 'm',
        default: false,
      },
    }
  })

  const {
    json: outputJson,
    markdown: outputMarkdown,
  } = cli.flags

  if (cli.input.length > 1) {
    throw new InputError('Only one package lookup supported at once')
  }

  const [rawPkgName = ''] = cli.input

  if (!rawPkgName) {
    cli.showHelp()
    return
  }

  const versionSeparator = rawPkgName.lastIndexOf('@')

  if (versionSeparator < 1) {
    throw new InputError('Need to specify a full package identifier, like eg: webtorrent@1.0.0')
  }

  const pkgName = rawPkgName.slice(0, versionSeparator)
  const pkgVersion = rawPkgName.slice(versionSeparator + 1)

  if (!pkgVersion) {
    throw new InputError('Need to specify a version, like eg: webtorrent@1.0.0')
  }

  const socketSdk = await setupSdk()

  const spinner = ora(`Looking up data for version ${pkgVersion} of ${pkgName}`).start()

  /** @type {Awaited<ReturnType<import('@socketsecurity/sdk').SocketSdk["getIssuesByNPMPackage"]>>} */
  let result

  try {
    result = await socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion)
  } catch (cause) {
    spinner.fail()
    throw new ErrorWithCause('Failed to look up package', { cause })
  }

  if (result.success === false) {
    if (result.status === 401 || result.status === 403) {
      spinner.stop()
      throw new AuthError(result.error.message)
    }
    spinner.fail(chalk.white.bgRed('API returned an error:') + ' ' + result.error.message)
    process.exit(1)
  }

  const data = result.data

  /** @typedef {(typeof data)[number]["value"] extends infer U | undefined ? U : never} SocketSdkIssue */
  /** @type {Record<SocketSdkIssue["severity"], number>} */
  const severityCount = { low: 0, middle: 0, high: 0, critical: 0 }
  for (const issue of data) {
    const value = issue.value

    if (!value) {
      continue
    }

    if (severityCount[value.severity] !== undefined) {
      severityCount[value.severity] += 1
    }
  }

  const issueSummary = stringJoinWithSeparateFinalSeparator([
    severityCount.critical ? severityCount.critical + ' critical' : undefined,
    severityCount.high ? severityCount.high + ' high' : undefined,
    severityCount.middle ? severityCount.middle + ' middle' : undefined,
    severityCount.low ? severityCount.low + ' low' : undefined,
  ])

  spinner.succeed(`Found ${issueSummary || 'no'} issues for version ${pkgVersion} of ${pkgName}`)

  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
    return
  }

  const format = new ChalkOrMarkdown(!!outputMarkdown)
  const url = `https://socket.dev/npm/package/${pkgName}/overview/${pkgVersion}`

  console.log('\nDetailed info on socket.dev: ' + format.hyperlink(`${pkgName} v${pkgVersion}`, url, { fallbackToUrl: true }))

  if (!outputMarkdown) {
    console.log(chalk.dim('\nOr rerun', chalk.italic(name), 'using the', chalk.italic('--json'), 'flag to get full JSON output'))
  }
}

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const info = { description, run }
