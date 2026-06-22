import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import constants, { SOCKET_JSON } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'dotnet',
  description:
    '[beta] Generate a Socket facts file from a .NET project (`.csproj`/`.sln`/etc)',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description:
        'Location of the dotnet host to use, default: dotnet on PATH',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    dotnetOpts: {
      type: 'string',
      description: 'Additional options to pass on to the bundled dotnet tool',
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    Emits a single \`.socket.facts.json\` describing the resolved dependency
    graph of your .NET project, using the \`dotnet\` host on PATH to run a
    bundled NuGet/MSBuild resolver (SDK-style projects and legacy
    \`packages.config\` are both supported). An unresolved dependency is a fatal
    error; pass --ignore-unresolved to warn and continue instead.

    Unlike the JVM generators there are no configuration filters: .NET
    resolution has no equivalent of Gradle/Maven configurations, so
    --include-configs / --exclude-configs do not apply.

    You can specify --bin to override the path to the \`dotnet\` host to invoke,
    and --dotnet-opts to pass extra options through to the bundled tool.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --bin=/usr/local/share/dotnet/dotnet .
  `,
}

export const cmdManifestDotnet = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
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

  const dryRun = !!cli.flags['dryRun']

  // TODO: Implement json/md further.
  const outputKind = getOutputKind(json, markdown)

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  debugFn(
    'inspect',
    `override: ${SOCKET_JSON} dotnet`,
    sockJson?.defaults?.manifest?.dotnet,
  )

  let { bin, dotnetOpts, ignoreUnresolved, verbose } = cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.dotnet?.bin) {
      bin = sockJson.defaults?.manifest?.dotnet?.bin
      logger.info(`Using default --bin from ${SOCKET_JSON}:`, bin)
    } else {
      bin = 'dotnet'
    }
  }
  if (!dotnetOpts) {
    if (sockJson.defaults?.manifest?.dotnet?.dotnetOpts) {
      dotnetOpts = sockJson.defaults?.manifest?.dotnet?.dotnetOpts
      logger.info(
        `Using default --dotnet-opts from ${SOCKET_JSON}:`,
        dotnetOpts,
      )
    } else {
      dotnetOpts = ''
    }
  }
  if (ignoreUnresolved === undefined) {
    if (sockJson.defaults?.manifest?.dotnet?.ignoreUnresolved !== undefined) {
      ignoreUnresolved = sockJson.defaults?.manifest?.dotnet?.ignoreUnresolved
      logger.info(
        `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
        ignoreUnresolved,
      )
    } else {
      ignoreUnresolved = false
    }
  }
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.dotnet?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.dotnet?.verbose
      logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
    } else {
      verbose = false
    }
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR (make sure to escape spaces!)',
    fail: 'received ' + cli.input.length,
  })
  if (!wasValidInput) {
    return
  }

  if (verbose) {
    logger.group()
    logger.info('- cwd:', cwd)
    logger.info('- dotnet bin:', bin)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const parsedDotnetOpts = parseBuildToolOpts(String(dotnetOpts || ''))

  await convertDotnetToFacts({
    bin: String(bin),
    cwd,
    dotnetOpts: parsedDotnetOpts,
    ignoreUnresolved: Boolean(ignoreUnresolved),
    verbose: Boolean(verbose),
  })
}
