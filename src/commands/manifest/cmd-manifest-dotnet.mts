import { statSync } from 'node:fs'
import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertDotnetToFacts } from './convert-dotnet-to-facts.mts'
import { excludePathsFlag } from './manifest-flags.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import constants, { SOCKET_JSON } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'
import { assertValidExcludePaths } from '../scan/exclude-paths.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'dotnet',
  description:
    '[beta] Generate Socket facts files from .NET solutions and projects',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description:
        'Location of the dotnet binary to use, default: dotnet on PATH',
    },
    dotnetOpts: {
      type: 'string',
      description:
        'Additional options to pass on to `dotnet restore`, e.g. `-p:Configuration=Release --configfile nuget.config`. MSBuild properties among them also apply to project evaluation',
    },
    includeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns matched against target frameworks (case-sensitive; `*`, `?`, and `[...]` wildcards). Only target frameworks matching at least one pattern are read, e.g. `net8.0`. A runtime-specific target (`net8.0/win-x64`) also matches its framework. Default: every target framework',
    },
    excludeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns; target frameworks matching any pattern are skipped (applied after --include-configs)',
    },
    ...excludePathsFlag,
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.|FILE]

    Options
      ${getFlagListOutput(config.flags)}

    Emits a \`<file>.socket.facts.json\` per solution or project describing its
    resolved NuGet dependency graph. Given a directory, it builds every
    solution (.sln, .slnx) and project (.csproj, .fsproj, .vbproj) at its top
    level, solutions first, skipping projects a solution already covers; given
    a file, just that one (a .slnf solution filter too).

    Dependencies come from your own \`dotnet restore\` (same SDK, global.json,
    nuget.config and credential providers), so a build that restores for you
    restores here. PackageReference projects (central package management and
    lock files included) and packages.config projects are supported. An
    unresolved dependency is a fatal error unless --ignore-unresolved.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} ./App.sln
      $ ${command} --dotnet-opts="-p:Configuration=Release" .
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

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR or FILE (make sure to escape spaces!)',
    fail: 'received ' + cli.input.length,
  })
  if (!wasValidInput) {
    return
  }

  const target = path.resolve(process.cwd(), cli.input[0] ?? '.')
  let isFile = false
  try {
    isFile = statSync(target).isFile()
  } catch {}
  const cwd = isFile ? path.dirname(target) : target
  const entryFile = isFile ? path.basename(target) : undefined

  const sockJson = readOrDefaultSocketJson(cwd)
  const defaults = sockJson.defaults?.manifest?.dotnet

  debugFn('inspect', `override: ${SOCKET_JSON} dotnet`, defaults)

  let {
    bin,
    dotnetOpts,
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    verbose,
  } = cli.flags

  function useDefault<T>(flag: string, value: T): T {
    logger.info(`Using default --${flag} from ${SOCKET_JSON}:`, value)
    return value
  }
  if (!bin) {
    bin = defaults?.bin
      ? useDefault('bin', defaults.bin)
      : resolveBuildToolBin('dotnet', cwd)
  }
  if (!dotnetOpts) {
    dotnetOpts = defaults?.dotnetOpts
      ? useDefault('dotnet-opts', defaults.dotnetOpts)
      : ''
  }
  if (includeConfigs === undefined) {
    includeConfigs = defaults?.includeConfigs
      ? useDefault('include-configs', defaults.includeConfigs)
      : ''
  }
  if (excludeConfigs === undefined) {
    excludeConfigs = defaults?.excludeConfigs
      ? useDefault('exclude-configs', defaults.excludeConfigs)
      : ''
  }
  if (ignoreUnresolved === undefined) {
    ignoreUnresolved =
      defaults?.ignoreUnresolved !== undefined
        ? useDefault('ignore-unresolved', defaults.ignoreUnresolved)
        : false
  }
  if (verbose === undefined) {
    verbose =
      defaults?.verbose !== undefined
        ? useDefault('verbose', defaults.verbose)
        : false
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
    logger.group()
    logger.info('- cwd:', cwd)
    logger.info('- entry:', entryFile ?? '(every solution and project)')
    logger.info('- dotnet bin:', bin)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertValidExcludePaths(excludePaths)

  await convertDotnetToFacts({
    bin: String(bin),
    cwd,
    dotnetOpts: parseBuildToolOpts(String(dotnetOpts || '')),
    entryFile,
    excludeConfigs: String(excludeConfigs || ''),
    excludePaths,
    ignoreUnresolved: Boolean(ignoreUnresolved),
    includeConfigs: String(includeConfigs || ''),
    verbose: Boolean(verbose),
  })
}
