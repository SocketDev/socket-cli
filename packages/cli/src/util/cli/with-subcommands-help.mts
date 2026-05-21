/**
 * Help-text rendering for `meowWithSubcommands`.
 *
 * Extracted from with-subcommands.mts to keep that file under the 1000-line
 * File-size cap. The function builds the `lines: string[]` passed to meow's
 * `help` option, with a "bucketed" layout for the root socket command and a
 * flat alphabetised list for sub-commands.
 *
 * Buckets are read from `opts.buckets` (a per-app `Record<commandName,
 * CliBucket>` map); the help builder iterates the registered `subcommands` and
 * groups each by its bucket. There is no parallel hand-maintained list — the
 * source of truth for "which bucket does X go in?" is one place: the
 * application's bucket map (e.g. `rootCommandBuckets` in `src/commands.mts`).
 *
 * Commands without a bucket assignment are valid but unsurfaced in the root
 * help (still reachable via name + still appear in sub-command help). Useful
 * for ecosystem-specific or experimental commands documented elsewhere.
 */

import terminalLink from 'terminal-link'
import colors from 'yoctocolors-cjs'

import { toSortedObject } from '@socketsecurity/lib-stable/objects'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts'

import {
  FLAG_HELP_FULL,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { NPM } from '../../constants/agents.mts'
import { API_V0_URL } from '../../constants/socket.mts'
import { getFlagListOutput, getHelpListOutput } from '../output/formatting.mts'
import { socketPackageLink } from '../terminal/link.mts'

import { description } from './with-subcommands-shared.mts'

import type {
  CliAliases,
  CliBucket,
  CliBuckets,
  CliSubcommand,
} from './with-subcommands-shared.mts'
import type { MeowFlag, MeowFlags } from '../../flags.mts'

const HELP_INDENT = 2
const HELP_PAD_NAME = 28

export interface BuildHelpLinesOptions {
  aliases: Record<string, CliAliases[string]>
  argv: readonly string[]
  /**
   * Per-subcommand bucket assignments. Only consumed for the root-command
   * layout; ignored for sub-commands.
   */
  buckets?: CliBuckets | undefined
  flags: MeowFlags
  isRootCommand: boolean
  name: string
  subcommands: Record<string, CliSubcommand>
}

interface BucketSection {
  readonly heading: string
  readonly bucket: CliBucket
}

/**
 * Display order + heading text for each bucket. Adding a new bucket = (a) add
 * the literal to `CliBucket` in with-subcommands-shared.mts, (b) add an entry
 * here. The compiler enforces both halves match.
 */
const BUCKET_SECTIONS: readonly BucketSection[] = [
  { heading: 'Main commands', bucket: 'main' },
  { heading: 'Socket API', bucket: 'api' },
  { heading: 'Local tools', bucket: 'tools' },
  { heading: 'CLI configuration', bucket: 'config' },
]

/**
 * Build the help-text lines passed to meow as the `help` option.
 *
 * For root `socket`: a bucketed layout (Main commands, Socket API, Local tools,
 * CLI configuration) plus optional environment-variable docs gated on
 * --help-full.
 *
 * For sub-commands (`socket scan`, `socket package`, …): a flat alphabetised
 * list of the subcommand's own children + aliases.
 */
export function buildHelpLines(opts: BuildHelpLinesOptions): string[] {
  const { aliases, argv, buckets, flags, isRootCommand, name, subcommands } =
    opts

  const lines = ['', 'Usage', `  $ ${name} <command>`]
  if (isRootCommand) {
    lines.push(
      `  $ ${name} scan create ${FLAG_JSON}`,
      `  $ ${name} package score ${NPM} lodash ${FLAG_MARKDOWN}`,
    )
  }
  lines.push('')

  if (isRootCommand) {
    pushRootBucketedLayout(lines, subcommands, buckets ?? {})
  } else {
    pushSubcommandFlatList(lines, subcommands, aliases)
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
    pushEnvironmentVariables(lines, argv)
  }

  return lines
}

export function describeOrFallback(
  cmd: CliSubcommand | undefined,
  fallback: string,
): string {
  return cmd ? description(cmd) : fallback
}

/**
 * Group registered subcommands by their bucket. Returns a Map keyed by bucket →
 * array of command names sorted naturally for display.
 *
 * Hidden commands and commands without a bucket assignment are excluded.
 */
export function groupCommandsByBucket(
  subcommands: Record<string, CliSubcommand>,
  buckets: CliBuckets,
): Map<CliBucket, string[]> {
  const grouped = new Map<CliBucket, string[]>()
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [cmdName, cmd] of Object.entries(subcommands)) {
    if (cmd.hidden) {
      continue
    }
    const bucket = buckets[cmdName]
    if (!bucket) {
      continue
    }
    let bucketNames = grouped.get(bucket)
    if (!bucketNames) {
      bucketNames = []
      grouped.set(bucket, bucketNames)
    }
    bucketNames.push(cmdName)
  }
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const names of grouped.values()) {
    names.sort(naturalCompare)
  }
  return grouped
}

export function hasHeroRows(bucket: CliBucket): boolean {
  return bucket === 'main'
}

export function pushEnvironmentVariables(
  lines: string[],
  argv: readonly string[],
): void {
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
      '  SOCKET_CLI_ACCEPT_RISKS     Accept risks of a Socket wrapped npm/pnpm exec run',
      '  SOCKET_CLI_VIEW_ALL_RISKS   View all risks of a Socket wrapped npm/pnpm exec run',
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

/**
 * Render the root help: header lines + each bucket section in order + static
 * "hero" rows in the Main bucket that aren't standalone commands (e.g. `socket
 * scan create`, `socket npm/<purl>`).
 */
export function pushRootBucketedLayout(
  lines: string[],
  subcommands: Record<string, CliSubcommand>,
  buckets: CliBuckets,
): void {
  const grouped = groupCommandsByBucket(subcommands, buckets)

  lines.push('Note: All commands have their own --help', '')

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { heading, bucket } of BUCKET_SECTIONS) {
    const names = grouped.get(bucket) ?? []
    if (names.length === 0 && !hasHeroRows(bucket)) {
      continue
    }
    lines.push(heading)
    if (bucket === 'main') {
      // Hero rows: static lines that aren't tied to a single command
      // entry but anchor the user's mental model. Order matches the
      // historical layout.
      lines.push(
        `  socket login                ${describeOrFallback(subcommands['login'], 'Socket API login and CLI setup')}`,
        '  socket scan create          Create a new Socket scan and report',
        '  socket npm/lodash@4.17.21   Request the Socket score of a package',
      )
    }
    for (let i = 0, { length } = names; i < length; i += 1) {
      const cmdName = names[i]!
      // Skip commands already covered by hero rows in `main`.
      if (bucket === 'main' && cmdName === 'login') {
        continue
      }
      const cmd = subcommands[cmdName]
      /* c8 ignore start - defensive: cmdName comes from grouped subcommands so the lookup always resolves */
      if (!cmd) {
        continue
      }
      /* c8 ignore stop */
      lines.push(`  ${cmdName.padEnd(HELP_PAD_NAME)}${description(cmd)}`)
    }
    lines.push('')
  }
}

export function pushSubcommandFlatList(
  lines: string[],
  subcommands: Record<string, CliSubcommand>,
  aliases: Record<string, CliAliases[string]>,
): void {
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
