// import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import yargsParse from 'yargs-parser'

import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { runCycloneDX } from './run-cyclonedx.mts'
import constants from '../../constants.mts'
import { isHelpFlag } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

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
    type: arrayToLower
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
    type: ['js']
    //validate: true,
  },
  alias: {
    help: ['h'],
    output: ['o'],
    print: ['p'],
    recurse: ['r'],
    'resolve-class': ['c'],
    type: ['t'],
    version: ['v'],
    yes: ['y']
  },
  array: [
    { key: 'author', type: 'string' },
    { key: 'exclude', type: 'string' },
    { key: 'filter', type: 'string' },
    { key: 'only', type: 'string' },
    { key: 'standard', type: 'string' },
    { key: 'type', type: 'string' }
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
    'version',
    // The --yes flag and -y alias map to the corresponding flag and alias of npx.
    // https://docs.npmjs.com/cli/v7/commands/npx#compatibility-with-older-npx-versions
    'yes'
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
    // Don't let meow take over --help.
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName
  })

  // TODO: Convert to meow.
  const yargv = {
    ...yargsParse(argv as string[], yargsConfig)
  } as any

  const unknown: string[] = yargv._
  const { length: unknownLength } = unknown
  if (unknownLength) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      `Unknown ${pluralize('argument', unknownLength)}: ${yargv._.join(', ')}`
    )
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  if (yargv.output === undefined) {
    yargv.output = 'socket-cdx.json'
  }

  await runCycloneDX(yargv)
}
