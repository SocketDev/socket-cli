/**
 * Help-text rendering for `meowWithSubcommands`.
 *
 * Extracted from with-subcommands.mts to keep that file under the
 * 1000-line File-size cap. The function builds the `lines: string[]`
 * passed to meow's `help` option, with a "bucketed" layout for the
 * root socket command and a flat alphabetised list for sub-commands.
 *
 * The function emits a few `logger.fail()` warnings as a side effect
 * when the actual subcommands map drifts from the canonical bucketed
 * Set — that's intentional, it's how we discover unbuckted commands
 * during development.
 */

import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import { joinAnd } from '@socketsecurity/lib/arrays'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { toSortedObject } from '@socketsecurity/lib/objects'
import { naturalCompare } from '@socketsecurity/lib/sorts'

import { NPM, NPX } from '../../constants/agents.mts'
import {
  FLAG_HELP_FULL,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { API_V0_URL } from '../../constants/socket.mts'
import { getFlagListOutput, getHelpListOutput } from '../output/formatting.mts'
import { socketPackageLink } from '../terminal/link.mts'

import { description } from './with-subcommands-shared.mts'

import type {
  CliAliases,
  CliSubcommand,
} from './with-subcommands-shared.mts'
import type { MeowFlag, MeowFlags } from '../../flags.mts'

const HELP_INDENT = 2
const HELP_PAD_NAME = 28

const logger = getDefaultLogger()

export interface BuildHelpLinesOptions {
  aliases: Record<string, CliAliases[string]>
  argv: readonly string[]
  flags: MeowFlags
  isRootCommand: boolean
  name: string
  subcommands: Record<string, CliSubcommand>
}

/**
 * Build the help-text lines passed to meow as the `help` option.
 *
 * For root `socket`: a bucketed layout (Main commands, Socket API,
 * Local tools, CLI configuration) plus optional environment-variable
 * docs gated on --help-full. Emits dev-time logger.fail warnings when
 * a subcommand isn't in the canonical bucketed Set.
 *
 * For sub-commands (`socket scan`, `socket package`, …): a flat
 * alphabetised list of the subcommand's own children + aliases.
 */
export function buildHelpLines(opts: BuildHelpLinesOptions): string[] {
  const { aliases, argv, flags, isRootCommand, name, subcommands } = opts

  const lines = ['', 'Usage', `  $ ${name} <command>`]
  if (isRootCommand) {
    lines.push(
      `  $ ${name} scan create ${FLAG_JSON}`,
      `  $ ${name} package score ${NPM} lodash ${FLAG_MARKDOWN}`,
    )
  }
  lines.push('')
  if (isRootCommand) {
    // "Bucket" some commands for easier usage.
    const commands = new Set([
      'analytics',
      'ask',
      'audit-log',
      'bundler',
      'cargo',
      'cdxgen',
      'ci',
      'config',
      'dependencies',
      'fix',
      'gem',
      'go',
      'install',
      //'json',
      'license',
      'login',
      'logout',
      'manifest',
      'mcp',
      NPM,
      NPX,
      'nuget',
      'optimize',
      'organization',
      'package',
      'patch',
      'pip',
      // PNPM,
      'pycli',
      'raw-npm',
      'raw-npx',
      'repository',
      'scan',
      //'security',
      'sfw',
      'threat-feed',
      'uninstall',
      'uv',
      'whoami',
      'wrapper',
      // YARN,
    ])
    Object.entries(subcommands)
      .filter(([_name, subcommand]) => !subcommand.hidden)
      .map(([name]) => name)
      .forEach(name => {
        if (commands.has(name)) {
          commands.delete(name)
        } else {
          logger.fail('Received an unknown command:', name)
        }
      })
    if (commands.size) {
      logger.fail(
        'Found commands in the list that were not marked as public or not defined at all:',
        // Node < 22 will print 'Object (n)' before the array. So to have consistent
        // test snapshots we use joinAnd.
        joinAnd(
          Array.from(commands)
            .sort(naturalCompare)
            .map(c => `'${c}'`),
        ),
      )
    }
    lines.push(
      'Note: All commands have their own --help',
      '',
      'Main commands',
      `  socket login                ${description(subcommands['login'])}`,
      '  socket scan create          Create a new Socket scan and report',
      '  socket npm/lodash@4.17.21   Request the Socket score of a package',
      `  socket fix                  ${description(subcommands['fix'])}`,
      `  socket optimize             ${description(subcommands['optimize'])}`,
      `  socket cdxgen               ${description(subcommands['cdxgen'])}`,
      `  socket ci                   ${description(subcommands['ci'])}`,
      '',
      'Socket API',
      `  analytics                   ${description(subcommands['analytics'])}`,
      `  audit-log                   ${description(subcommands['audit-log'])}`,
      `  organization                ${description(subcommands['organization'])}`,
      `  package                     ${description(subcommands['package'])}`,
      `  repository                  ${description(subcommands['repository'])}`,
      `  scan                        ${description(subcommands['scan'])}`,
      `  threat-feed                 ${description(subcommands['threat-feed'])}`,
      '',
      'Local tools',
      `  manifest                    ${description(subcommands['manifest'])}`,
      `  npm                         ${description(subcommands[NPM])}`,
      `  npx                         ${description(subcommands[NPX])}`,
      `  pycli                       ${description(subcommands['pycli'])}`,
      `  raw-npm                     ${description(subcommands['raw-npm'])}`,
      `  raw-npx                     ${description(subcommands['raw-npx'])}`,
      `  sfw                         ${description(subcommands['sfw'])}`,
      '',
      'CLI configuration',
      `  config                      ${description(subcommands['config'])}`,
      `  install                     ${description(subcommands['install'])}`,
      '  login                       Socket API login and CLI setup',
      `  logout                      ${description(subcommands['logout'])}`,
      `  uninstall                   ${description(subcommands['uninstall'])}`,
      `  whoami                      ${description(subcommands['whoami'])}`,
      `  wrapper                     ${description(subcommands['wrapper'])}`,
    )
  } else {
    lines.push('Commands')
    lines.push(
      `  ${getHelpListOutput(
        {
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(subcommands).filter(
                ({ 1: subcommand }) => !subcommand.hidden,
              ),
            ),
          ),
          ...toSortedObject(
            Object.fromEntries(
              Object.entries(aliases).filter(({ 1: alias }) => {
                const { hidden } = alias
                const cmdName = hidden ? '' : alias.argv[0]
                const subcommand = cmdName ? subcommands[cmdName] : undefined
                return subcommand && !subcommand.hidden
              }),
            ),
          ),
        },
        { indent: HELP_INDENT, padName: HELP_PAD_NAME },
      )}`,
    )
  }

  lines.push('', 'Options')
  if (isRootCommand) {
    lines.push(
      '  Note: All commands have these flags even when not displayed in their help',
      '',
    )
  } else {
    lines.push('')
  }
  lines.push(
    `  ${getFlagListOutput(
      {
        ...flags,
        // Explicitly document the negated --no-banner variant.
        noBanner: {
          ...flags['banner'],
          hidden: false,
        } as MeowFlag,
        // Explicitly document the negated --no-spinner variant.
        noSpinner: {
          ...flags['spinner'],
          hidden: false,
        } as MeowFlag,
      },
      { indent: HELP_INDENT, padName: HELP_PAD_NAME },
    )}`,
  )
  if (isRootCommand) {
    // Check if we should show full help with environment variables.
    const showFullHelp = argv.includes(FLAG_HELP_FULL)

    if (showFullHelp) {
      // Show full help with environment variables.
      lines.push(
        '',
        'Environment variables',
        '  SOCKET_CLI_API_TOKEN        Set the Socket API token',
        '  SOCKET_CLI_CONFIG           A JSON stringified Socket configuration object',
        '  GITHUB_API_URL              Change the base URL for GitHub REST API calls',
        '  SOCKET_CLI_GIT_USER_EMAIL   The git config `user.email` used by Socket CLI',
        `                              ${colors.italic('Defaults:')} github-actions[bot]@users.noreply.github.com`,
        '  SOCKET_CLI_GIT_USER_NAME    The git config `user.name` used by Socket CLI',
        `                              ${colors.italic('Defaults:')} github-actions[bot]`,
        `  SOCKET_CLI_GITHUB_TOKEN     A classic or fine-grained ${terminalLink('GitHub personal access token', 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens')}`,
        `                              ${colors.italic('Aliases:')} GITHUB_TOKEN`,
        '  SOCKET_CLI_NO_API_TOKEN     Make the default API token `undefined`',
        '  SOCKET_CLI_NPM_PATH         The absolute location of the npm directory',
        '  SOCKET_CLI_ORG_SLUG         Specify the Socket organization slug',
        '',
        '  SOCKET_CLI_ACCEPT_RISKS     Accept risks of a Socket wrapped npm/npx run',
        '  SOCKET_CLI_VIEW_ALL_RISKS   View all risks of a Socket wrapped npm/npx run',
        '',
        'Environment variables for development',
        '  SOCKET_CLI_API_BASE_URL     Change the base URL for Socket API calls',
        `                              ${colors.italic('Defaults:')} The "apiBaseUrl" value of socket/settings local app data`,
        `                              if present, else ${API_V0_URL}`,
        '  SOCKET_CLI_API_PROXY        Set the proxy Socket API requests are routed through, e.g. if set to',
        `                              ${terminalLink('http://127.0.0.1:9090', 'https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries')} then all request are passed through that proxy`,
        `                              ${colors.italic('Aliases:')} HTTPS_PROXY, https_proxy, HTTP_PROXY, and http_proxy`,
        '  SOCKET_CLI_API_TIMEOUT      Set the timeout in milliseconds for Socket API requests',
        '  SOCKET_CLI_DEBUG            Enable debug logging in Socket CLI',
        `  DEBUG                       Enable debug logging based on the ${socketPackageLink('npm', 'debug', undefined, 'debug')} package`,
      )
    } else {
      // Show condensed help with hint about --help-full.
      lines.push(
        '',
        'Environment variables [more…]',
        `  Use ${colors.bold(FLAG_HELP_FULL)} to view all environment variables`,
      )
    }
  }

  return lines
}
