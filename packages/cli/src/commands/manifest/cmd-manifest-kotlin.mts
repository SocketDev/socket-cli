import path from 'node:path'

import { debug } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { convertGradleToMaven } from './convert-gradle-to-maven.mts'
import { outputManifest } from './output-manifest.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mjs'
import { REQUIREMENTS_TXT } from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { readOrDefaultSocketJson } from '../../utils/socket/json.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'
const logger = getDefaultLogger()


import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

// Design note: Gradle language commands (gradle, kotlin, scala) share similar code
// but maintain separate commands for clarity. This allows language-specific help text
// and clearer user experience (e.g., "socket manifest kotlin" shows Kotlin-specific
// help rather than generic gradle help). Future refactoring could extract shared logic
// while preserving separate command interfaces.
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
      ${getFlagListOutput(config.flags)}

    Uses gradle, preferably through your local project \`gradlew\`, to generate a
    \`pom.xml\` file for each task. If you have no \`gradlew\` you can try the
    global \`gradle\` binary but that may not work (hard to predict).

    The \`pom.xml\` is a manifest file similar to \`package.json\` for npm or
    or ${REQUIREMENTS_TXT} for PyPi), but specifically for Maven, which is Java's
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

  // Feature request: Pass outputKind to convertGradleToMaven for json/md output support.
  const outputKind = getOutputKind(json, markdown)

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  debug(
    `override: ${SOCKET_JSON} gradle: ${sockJson?.defaults?.manifest?.gradle}`,
  )

  let { bin, gradleOpts, verbose } = cli.flags as unknown as {
    bin: string | undefined
    gradleOpts: string | undefined
    verbose: boolean | undefined
  }

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.gradle?.bin) {
      bin = sockJson.defaults?.manifest?.gradle?.bin
      logger.info(`Using default --bin from ${SOCKET_JSON}:`, bin)
    } else {
      bin = path.join(cwd, 'gradlew')
    }
  }
  if (!gradleOpts) {
    if (sockJson.defaults?.manifest?.gradle?.gradleOpts) {
      gradleOpts = sockJson.defaults?.manifest?.gradle?.gradleOpts
      logger.info(
        `Using default --gradle-opts from ${SOCKET_JSON}:`,
        gradleOpts,
      )
    } else {
      gradleOpts = ''
    }
  }
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.gradle?.verbose
      logger.info(
        `Using default --verbose from ${SOCKET_JSON}:`,
        verbose,
      )
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

  // Note: stdin input not supported. Gradle manifest generation requires a directory
  // context with build files (build.gradle.kts, settings.gradle.kts, etc.) that can't be
  // meaningfully provided via stdin.

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: cli.input.length <= 1,
    message: 'Can only accept one DIR (make sure to escape spaces!)',
    fail: `received ${cli.input.length}`,
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

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const result = await convertGradleToMaven({
    bin: String(bin),
    cwd,
    gradleOpts: String(gradleOpts || '')
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean),
    outputKind,
    verbose: Boolean(verbose),
  })

  // In text mode, output is already handled by convertGradleToMaven.
  // For json/markdown modes, we need to call the output helper.
  if (outputKind !== 'text') {
    await outputManifest(result, outputKind, '-')
  }
}
