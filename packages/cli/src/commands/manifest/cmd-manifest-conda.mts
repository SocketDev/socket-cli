import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { handleManifestConda } from './handle-manifest-conda.mts'
import {
  resolveCondaInfile,
  resolveCondaOutfile,
} from './manifest-build-trust.mts'
import { outputRequirements } from './output-requirements.mts'
import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mjs'
import {
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  REQUIREMENTS_TXT,
} from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const logger = getDefaultLogger()

// Flags interface for type safety.
export interface CondaFlags {
  dryRun: boolean
  file: string
  json: boolean
  markdown: boolean
  out: string
  stdin: boolean | undefined
  stdout: boolean | undefined
  trustSocketJson: boolean | undefined
  verbose: boolean | undefined
}

const config = {
  commandName: 'conda',
  description: `[beta] Convert a Conda ${ENVIRONMENT_YML} file to a python ${REQUIREMENTS_TXT}`,
  flags: defineFlags({
    ...commonFlags,
    ...outputFlags,
    file: {
      type: 'string',
      default: '',
      description: `Input file name (by default for Conda this is "${ENVIRONMENT_YML}"), relative to cwd`,
    },
    stdin: {
      type: 'boolean',
      description: 'Read the input from stdin (supersedes --file)',
    },
    out: {
      type: 'string',
      default: '',
      description: 'Output path (relative to cwd)',
    },
    stdout: {
      type: 'boolean',
      description: `Print resulting ${REQUIREMENTS_TXT} to stdout (supersedes --out)`,
    },
    trustSocketJson: {
      type: 'boolean',
      default: false,
      description: `Read and write the paths declared in ${SOCKET_JSON} even when they leave the project. Off by default because the scanned repository controls that file.`,
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  }),
  help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    Warning: While we don't support Conda necessarily, this tool extracts the pip
             block from an ${ENVIRONMENT_YML} and outputs it as a ${REQUIREMENTS_TXT}
             which you can scan as if it were a PyPI package.

    USE AT YOUR OWN RISK

    Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
          contents of a file to have it processed.

    A ${SOCKET_JSON} \`infile\` or \`outfile\` that resolves outside CWD is
    refused unless you pass --trust-socket-json: the repository being scanned
    owns that file, and the output content comes from its own ${ENVIRONMENT_YML}.
    Pass --file and --out yourself to read or write outside CWD without trusting
    ${SOCKET_JSON}.

    Options
      ${getFlagListOutput(helpConfig.flags)}

    Examples

      $ ${command}
      $ ${command} ./project/foo --file ${ENVIRONMENT_YAML}
  `,
  hidden: false,
}

export const cmdManifestConda = {
  description: config.description,
  hidden: config.hidden,
  run,
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

  const { dryRun, json, markdown, trustSocketJson } = cli.flags

  const outputKind = getOutputKind(json, markdown)

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  let { file: filename, out, stdin, stdout, verbose } = cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (
    stdin === undefined &&
    sockJson.defaults?.manifest?.conda?.stdin !== undefined
  ) {
    stdin = sockJson.defaults?.manifest?.conda?.stdin
    logger.info(`Using default --stdin from ${SOCKET_JSON}:`, stdin)
  }
  if (stdin) {
    filename = '-'
  } else {
    const infile = resolveCondaInfile({
      cliFile: filename,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!infile.ok) {
      await outputRequirements(infile, outputKind, '-')
      return
    }
    filename = infile.data
  }
  if (
    stdout === undefined &&
    sockJson.defaults?.manifest?.conda?.stdout !== undefined
  ) {
    stdout = sockJson.defaults?.manifest?.conda?.stdout
    logger.info(`Using default --stdout from ${SOCKET_JSON}:`, stdout)
  }
  if (stdout) {
    out = '-'
  } else {
    const outfile = resolveCondaOutfile({
      cliOut: out,
      cwd,
      socketJson: sockJson,
      trustSocketJson,
    })
    if (!outfile.ok) {
      await outputRequirements(outfile, outputKind, '-')
      return
    }
    out = outfile.data
  }
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.conda?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.conda?.verbose
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
  } else if (verbose === undefined) {
    verbose = false
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- target:', cwd)
    logger.log('- output:', out)
    logger.groupEnd()
  }

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      fail: `received ${cli.input.length}`,
    },
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  logger.warn(
    'Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk.',
  )

  if (dryRun) {
    outputDryRunExecute(
      'conda converter',
      [filename, out],
      `convert Conda ${ENVIRONMENT_YML} to ${REQUIREMENTS_TXT}`,
    )
    return
  }

  await handleManifestConda({
    cwd,
    filename,
    out,
    outputKind,
    verbose,
  })
}
