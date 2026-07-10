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
    '[beta] Generate a Socket facts file for a .NET (C#/F#/VB) project',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description:
        'Location of the dotnet binary to use, default: dotnet on PATH',
    },
    targetFrameworks: {
      type: 'string',
      description:
        'Comma-separated glob patterns matched against target framework names (case-sensitive; `*`, `?`, and `[...]` wildcards). Only target frameworks matching at least one pattern are included, e.g. `net8.0` or `net*`. Default: every restored target framework',
    },
    excludeTargetFrameworks: {
      type: 'string',
      description:
        'Comma-separated glob patterns; target frameworks matching any pattern are skipped (applied after --target-frameworks)',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'Warn on restore/resolution failures instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    dotnetOpts: {
      type: 'string',
      description:
        'MSBuild property tokens (`-p:Key=Value`) applied to the whole facts session: project evaluation, restore, and reading the restore output all see the same properties',
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
    graph of the .NET solutions/projects at the top level of the given
    directory. A bundled tool runs one MSBuild session — evaluate, restore,
    read the restore output via NuGet's own APIs — so results reflect exactly
    what NuGet resolved. A restore failure is a fatal error; pass
    --ignore-unresolved to warn instead.

    Each target framework a project restores is resolved separately: pass
    --target-frameworks / --exclude-target-frameworks (comma-separated glob
    patterns) to control which target frameworks are included (e.g.
    --target-frameworks='net8.0'). RID-specific targets like net8.0/win-x64
    match under their base target framework.

    --dotnet-opts takes MSBuild property tokens (\`-p:Key=Value\`), applied to
    the WHOLE session so evaluation, restore, and the emitted graph can never
    disagree. Restore-specific settings have property forms, e.g.
    \`-p:RestoreSources=<url>\` or \`-p:RestoreConfigFile=<path>\`.

    Requires a .NET SDK (6.0 or newer). Legacy \`packages.config\` projects
    are supported from the manifest itself (it pins the full closure): the
    graph is flat — every package is listed as a direct dependency — and
    \`developmentDependency="true"\` packages are marked dev. No restore is
    attempted for them.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --target-frameworks='net8.0' .
      $ ${command} --dotnet-opts='-p:Configuration=Release' .
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

  let {
    bin,
    dotnetOpts,
    excludeTargetFrameworks,
    ignoreUnresolved,
    targetFrameworks,
    verbose,
  } = cli.flags

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
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.dotnet?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.dotnet?.verbose
      logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
    } else {
      verbose = false
    }
  }
  if (targetFrameworks === undefined) {
    if (sockJson.defaults?.manifest?.dotnet?.targetFrameworks !== undefined) {
      targetFrameworks = sockJson.defaults?.manifest?.dotnet?.targetFrameworks
      logger.info(
        `Using default --target-frameworks from ${SOCKET_JSON}:`,
        targetFrameworks,
      )
    } else {
      targetFrameworks = ''
    }
  }
  if (excludeTargetFrameworks === undefined) {
    if (
      sockJson.defaults?.manifest?.dotnet?.excludeTargetFrameworks !== undefined
    ) {
      excludeTargetFrameworks =
        sockJson.defaults?.manifest?.dotnet?.excludeTargetFrameworks
      logger.info(
        `Using default --exclude-target-frameworks from ${SOCKET_JSON}:`,
        excludeTargetFrameworks,
      )
    } else {
      excludeTargetFrameworks = ''
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

  await convertDotnetToFacts({
    bin: String(bin),
    cwd,
    dotnetOpts: parseBuildToolOpts(String(dotnetOpts || '')),
    excludeConfigs: String(excludeTargetFrameworks || ''),
    ignoreUnresolved: Boolean(ignoreUnresolved),
    includeConfigs: String(targetFrameworks || ''),
    verbose: Boolean(verbose),
  })
}
