import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../utils/socketjson.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

// TODO: we may want to dedupe some pieces for all gradle languages. I think it
//       makes sense to have separate commands for them and I think it makes
//       sense for the help panels to note the requested language, rather than
//       `socket manifest kotlin` to print help screens with `gradle` as the
//       command. Room for improvement.
const config: CliCommandConfig = {
  commandName: 'kotlin',
  description:
    '[beta] Use Gradle to generate a manifest file (`pom.xml`) for a Kotlin project',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of gradlew binary to use, default: CWD/gradlew',
    },
    gradleOpts: {
      type: 'string',
      description:
        'Additional options to pass on to ./gradlew, see `./gradlew --help`',
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
      ${getFlagListOutput(config.flags, 6)}

    Uses gradle, preferably through your local project \`gradlew\`, to generate a
    \`pom.xml\` file for each task. If you have no \`gradlew\` you can try the
    global \`gradle\` binary but that may not work (hard to predict).

    The \`pom.xml\` is a manifest file similar to \`package.json\` for npm or
    or requirements.txt for PyPi), but specifically for Maven, which is Java's
    dependency repository. Languages like Kotlin and Scala piggy back on it too.

    There are some caveats with the gradle to \`pom.xml\` conversion:

    - each task will generate its own xml file and by default it generates one xml
      for every task. (This may be a good thing!)

    - it's possible certain features don't translate well into the xml. If you
      think something is missing that could be supported please reach out.

    - it works with your \`gradlew\` from your repo and local settings and config

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --bin=../gradlew .
  `,
}

export const cmdManifestKotlin = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json = false, markdown = false } = cli.flags
  let { bin, gradleOpts, verbose } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further
  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = await readOrDefaultSocketJson(cwd)

  debugFn(
    'inspect',
    'override: socket.json gradle',
    sockJson?.defaults?.manifest?.gradle,
  )

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.gradle?.bin) {
      bin = sockJson.defaults?.manifest?.gradle?.bin
      logger.info('Using default --bin from socket.json:', bin)
    } else {
      bin = path.join(cwd, 'gradlew')
    }
  }
  if (!gradleOpts) {
    if (sockJson.defaults?.manifest?.gradle?.gradleOpts) {
      gradleOpts = sockJson.defaults?.manifest?.gradle?.gradleOpts
      logger.info('Using default --gradleOpts from socket.json:', gradleOpts)
    } else {
      gradleOpts = ''
    }
  }
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.gradle?.verbose
      logger.info('Using default --verbose from socket.json:', verbose)
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

  // TODO: I'm not sure it's feasible to parse source file from stdin. We could
  //       try, store contents in a file in some folder, target that folder... what
  //       would the file name be?

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR (make sure to escape spaces!)',
    pass: 'ok',
    fail: 'received ' + cli.input.length,
  })
  if (!wasValidInput) {
    return
  }

  if (verbose) {
    logger.group()
    logger.info('- cwd:', cwd)
    logger.info('- gradle bin:', bin)
    logger.groupEnd()
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await convertGradleToMaven({
    bin: String(bin),
    cwd,
    gradleOpts: String(gradleOpts || '')
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean),
    verbose: Boolean(verbose),
  })
}
