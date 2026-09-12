import path from 'node:path'
import process from 'node:process'

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { convertMavenToFacts } from './convert-maven-to-facts.mts'
import { resolveMavenInvocation } from './manifest-build-trust.mts'
import { outputManifest } from './output-manifest.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { commonFlags } from '../../flags.mts'
import { defineFlags } from '../../meow.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { cmdFlagValueToArray } from '../../util/process/cmd.mts'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'
import { assertNoNegationPatterns } from '../scan/exclude-paths.mts'
import { excludePathsFlag } from '../scan/reachability-flags.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'
import type { SocketJson } from '../../util/socket/json.mts'

const logger = getDefaultLogger()

// Flags interface for type safety.
export interface MavenFlags {
  bin: string | undefined
  excludeConfigs: string | undefined
  ignoreUnresolved: boolean | undefined
  includeConfigs: string | undefined
  mavenOpts: string | undefined
  trustSocketJson: boolean | undefined
  verbose: boolean | undefined
}

const config = {
  commandName: 'maven',
  description:
    '[beta] Generate a Socket facts file from a Maven `pom.xml` project',
  flags: defineFlags({
    ...commonFlags,
    bin: {
      type: 'string',
      description:
        'Location of the maven binary to use, default: ./mvnw if present, else mvn on PATH',
    },
    includeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns matched against Maven dependency scopes (case-sensitive; `*`, `?`, and `[...]` wildcards). Only scopes matching at least one pattern are resolved. e.g. `compile,runtime`. Default: every scope',
    },
    excludeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns; Maven scopes matching any pattern are skipped (applied after --include-configs)',
    },
    ...excludePathsFlag,
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    mavenOpts: {
      type: 'string',
      description:
        'Additional options to pass on to maven, e.g. `-P <profile> -s <settings.xml>`',
    },
    trustSocketJson: {
      type: 'boolean',
      default: false,
      description: `Run the binary and options declared in ${SOCKET_JSON}. Off by default because the scanned repository controls that file.`,
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  }),
  help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(helpConfig.flags)}

    Emits a single \`.socket.facts.json\` describing the resolved dependency
    graph of your Maven project, using maven (\`./mvnw\` if present, else
    \`mvn\` on PATH). It reads dependency metadata only and never downloads
    artifacts; an unresolved dependency is a fatal error. You can pass
    --include-configs / --exclude-configs (comma-separated glob patterns) to
    control which Maven scopes are resolved (e.g.
    --include-configs=\`compile,runtime\`), and --ignore-unresolved to warn on
    unresolved dependencies instead of failing.

    You can specify --bin to override the path to the \`mvn\` binary to invoke,
    and --maven-opts to pass extra options through to maven (e.g.
    \`-P <profile> -s <settings.xml>\`). A ${SOCKET_JSON} that points \`bin\`
    somewhere else, or that sets \`mavenOpts\`, is refused unless you pass
    --trust-socket-json: those values choose what gets executed and the
    repository being scanned owns that file.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --bin=./mvnw .
      $ ${command} --maven-opts="-P release" .
  `,
  hidden: false,
}

export const cmdManifestMaven = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export function resolveMavenExcludeConfigs(
  socketJson: SocketJson,
  value: string | undefined,
): string {
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.maven?.excludeConfigs
  if (configured === undefined) {
    return ''
  }
  logger.info(
    `Using default --exclude-configs from ${SOCKET_JSON}:`,
    configured,
  )
  return configured
}

export function resolveMavenIgnoreUnresolved(
  socketJson: SocketJson,
  options?: { value?: boolean | undefined } | undefined,
): boolean {
  const { value } = { __proto__: null, ...options }
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.maven?.ignoreUnresolved
  if (configured === undefined) {
    return false
  }
  logger.info(
    `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
    configured,
  )
  return configured
}

export function resolveMavenIncludeConfigs(
  socketJson: SocketJson,
  value: string | undefined,
): string {
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.maven?.includeConfigs
  if (configured === undefined) {
    return ''
  }
  logger.info(
    `Using default --include-configs from ${SOCKET_JSON}:`,
    configured,
  )
  return configured
}

export function resolveMavenVerbose(
  socketJson: SocketJson,
  options?: { value?: boolean | undefined } | undefined,
): boolean {
  const { value } = { __proto__: null, ...options }
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.maven?.verbose
  if (configured === undefined) {
    return false
  }
  logger.info(`Using default --verbose from ${SOCKET_JSON}:`, configured)
  return configured
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json = false, markdown = false } = cli.flags

  const dryRun = cli.flags['dryRun']

  // Feature request: Pass outputKind to convertMavenToFacts for json/md output support.
  const outputKind = getOutputKind(json, markdown)

  let { 0: cwd = '.' } = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  debug(
    `override: ${SOCKET_JSON} maven: ${JSON.stringify(sockJson?.defaults?.manifest?.maven)}`,
  )

  const { bin: binFlag, mavenOpts: mavenOptsFlag, trustSocketJson } = cli.flags

  const { excludeConfigs, ignoreUnresolved, includeConfigs, verbose } =
    cli.flags

  // The bin and its options choose what gets executed, so they route through
  // the socket.json trust gate. The remaining socket.json defaults below only
  // shape the emitted facts and are honored untrusted.
  const invocation = resolveMavenInvocation({
    cliBin: binFlag,
    cliOpts: mavenOptsFlag,
    cwd,
    socketJson: sockJson,
    trustSocketJson,
  })
  if (!invocation.ok) {
    await outputManifest(invocation, outputKind, '-')
    return
  }

  const { bin, opts: mavenOpts } = invocation.data

  const resolvedExcludeConfigs = resolveMavenExcludeConfigs(
    sockJson,
    excludeConfigs,
  )
  const resolvedIgnoreUnresolved = resolveMavenIgnoreUnresolved(sockJson, {
    value: ignoreUnresolved,
  })
  const resolvedIncludeConfigs = resolveMavenIncludeConfigs(
    sockJson,
    includeConfigs,
  )
  const resolvedVerbose = resolveMavenVerbose(sockJson, { value: verbose })

  if (resolvedVerbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  // Note: stdin input not supported. Maven manifest generation requires a
  // directory context with a pom.xml that can't be meaningfully provided via
  // stdin.

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR (make sure to escape spaces!)',
    fail: `received ${cli.input.length}`,
  })
  if (!wasValidInput) {
    return
  }

  if (resolvedVerbose) {
    logger.group()
    logger.info('- cwd:', cwd)
    logger.info('- maven bin:', bin)
    logger.groupEnd()
  }

  if (dryRun) {
    const args = [cwd, '--bin', bin]
    if (mavenOpts.length) {
      args.push('--maven-opts', mavenOpts.join(' '))
    }
    outputDryRunExecute(
      'mvn',
      args,
      'generate .socket.facts.json from Maven project',
    )
    return
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertNoNegationPatterns(excludePaths)

  await convertMavenToFacts({
    bin,
    cwd,
    excludeConfigs: resolvedExcludeConfigs,
    excludePaths,
    ignoreUnresolved: resolvedIgnoreUnresolved,
    includeConfigs: resolvedIncludeConfigs,
    mavenOpts,
    verbose: resolvedVerbose,
  })
}
