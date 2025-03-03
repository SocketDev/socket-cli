// import { meowOrExit } from '../../utils/meow-with-subcommands'
import process from 'node:process'

import yargsParse from 'yargs-parser'

import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { runCycloneDX } from './run-cyclonedx'
import constants from '../../constants'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

// TODO: convert yargs to meow. Or convert all the other things to yargs.
const toLower = (arg: string) => arg.toLowerCase()
const arrayToLower = (arg: string[]) => arg.map(toLower)

const yargsConfig = {
  configuration: {
    'camel-case-expansion': false,
    'strip-aliased': true,
    'parse-numbers': false,
    'populate--': true,
    'unknown-options-as-args': true
  },
  coerce: {
    author: arrayToLower,
    filter: arrayToLower,
    only: arrayToLower,
    profile: toLower,
    standard: arrayToLower,
    type: toLower
  },
  default: {
    //author: ['OWASP Foundation'],
    //'auto-compositions': true,
    //babel: true,
    //evidence: false,
    //'include-crypto': false,
    //'include-formulation': false,

    // Default 'install-deps' to `false` and 'lifecycle' to 'pre-build' to
    // sidestep arbitrary code execution during a cdxgen scan.
    // https://github.com/CycloneDX/cdxgen/issues/1328
    'install-deps': false,
    lifecycle: 'pre-build',

    //output: 'bom.json',
    //profile: 'generic',
    //'project-version': '',
    //recurse: true,
    //'server-host': '127.0.0.1',
    //'server-port': '9090',
    //'spec-version': '1.5',
    type: 'js'
    //validate: true,
  },
  alias: {
    help: ['h'],
    output: ['o'],
    print: ['p'],
    recurse: ['r'],
    'resolve-class': ['c'],
    type: ['t'],
    version: ['v']
  },
  array: [
    { key: 'author', type: 'string' },
    { key: 'exclude', type: 'string' },
    { key: 'filter', type: 'string' },
    { key: 'only', type: 'string' },
    { key: 'standard', type: 'string' }
  ],
  boolean: [
    'auto-compositions',
    'babel',
    'deep',
    'evidence',
    'fail-on-error',
    'generate-key-and-sign',
    'help',
    'include-formulation',
    'include-crypto',
    'install-deps',
    'print',
    'required-only',
    'server',
    'validate',
    'version'
  ],
  string: [
    'api-key',
    'lifecycle',
    'output',
    'parent-project-id',
    'profile',
    'project-group',
    'project-name',
    'project-version',
    'project-id',
    'server-host',
    'server-port',
    'server-url',
    'spec-version'
  ]
}

const config: CliCommandConfig = {
  commandName: 'cdxgen',
  description: 'Create an SBOM with CycloneDX generator (cdxgen)',
  hidden: false,
  flags: {
    // TODO: convert from yargsConfig
  },
  help: (command, config) => `
    Usage
      $ ${command} [options]

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdCdxgen = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    allowUnknownFlags: true,
    argv: argv.filter(s => s !== '--help' && s !== '-h'), // Don't let meow take over --help
    config,
    importMeta,
    parentName
  })
  //
  //
  // if (cli.input.length)
  //   logger.error(`${colors.bgRed(colors.white('Input error'))}: Please provide the required fields:\n
  //     - Unexpected arguments\n
  //   `)
  //   config.help(parentName, config)
  //   return
  // }

  // TODO: convert to meow
  const yargv = {
    ...yargsParse(argv as string[], yargsConfig)
  } as any // as Record<string, unknown>;

  const unknown: string[] = yargv._
  const { length: unknownLength } = unknown
  if (unknownLength) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.error(
      `Unknown ${pluralize('argument', unknownLength)}: ${yargv._.join(', ')}`
    )
    return
  }

  if (yargv.output === undefined) {
    yargv.output = 'socket-cdx.json'
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  await runCycloneDX(yargv)
}
