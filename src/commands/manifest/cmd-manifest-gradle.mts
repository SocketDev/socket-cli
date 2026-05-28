import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import constants, { REQUIREMENTS_TXT, SOCKET_JSON } from '../../constants.mts'
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
  commandName: 'gradle',
  description:
    '[beta] Use Gradle to generate a manifest file (`pom.xml`) for a Gradle/Java/Kotlin/etc project',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of gradlew binary to use, default: CWD/gradlew',
    },
    facts: {
      type: 'boolean',
      description:
        'Emit a Socket facts JSON file (`.socket.facts.json`) describing the resolved dependency graph instead of generating `pom.xml` files',
    },
    configs: {
      type: 'string',
      description:
        'With --facts: comma-separated Gradle configuration name suffixes to resolve (case-insensitive, e.g. `compileClasspath,runtimeClasspath`). Default: every resolvable configuration except AGP instrumented-test classpaths',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'With --facts: skip dependencies that fail to resolve instead of failing the run',
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

    Pass --facts to instead emit a single \`.socket.facts.json\` describing the
    resolved dependency graph of the whole build (no \`pom.xml\` files). An
    unresolved dependency is a fatal error. With --facts you can pass
    --configs=compileClasspath,runtimeClasspath to restrict resolution to
    matching configurations (case-insensitive suffix match), and
    --ignore-unresolved to skip dependencies that fail to resolve.

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --facts .
      $ ${command} --bin=../gradlew .
  `,
}

export const cmdManifestGradle = {
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
    `override: ${SOCKET_JSON} gradle`,
    sockJson?.defaults?.manifest?.gradle,
  )

  let { bin, configs, facts, gradleOpts, ignoreUnresolved, verbose } = cli.flags

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
      logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
    } else {
      verbose = false
    }
  }
  if (facts === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.facts !== undefined) {
      facts = sockJson.defaults?.manifest?.gradle?.facts
      logger.info(`Using default --facts from ${SOCKET_JSON}:`, facts)
    } else {
      facts = false
    }
  }
  if (configs === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.configs !== undefined) {
      configs = sockJson.defaults?.manifest?.gradle?.configs
      logger.info(`Using default --configs from ${SOCKET_JSON}:`, configs)
    } else {
      configs = ''
    }
  }
  if (ignoreUnresolved === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.ignoreUnresolved !== undefined) {
      ignoreUnresolved = sockJson.defaults?.manifest?.gradle?.ignoreUnresolved
      logger.info(
        `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
        ignoreUnresolved,
      )
    } else {
      ignoreUnresolved = false
    }
  }

  // `--configs` and `--ignore-unresolved` only affect --facts; the pom path
  // (the legacy `socketGenerateMaven` task) has no equivalent knobs. Warn
  // rather than silently ignore an explicitly-passed flag. (socket.json
  // defaults don't trip this — only a flag actually present on the command
  // line does.)
  if (
    !facts &&
    (cli.flags['configs'] !== undefined ||
      cli.flags['ignoreUnresolved'] !== undefined)
  ) {
    logger.warn(
      'The `--configs` and `--ignore-unresolved` options only apply with `--facts`; ignoring them.',
    )
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  // TODO: We're not sure it's feasible to parse source file from stdin. We could
  //       try, store contents in a file in some folder, target that folder... what
  //       would the file name be?

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
    logger.info('- gradle bin:', bin)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const parsedGradleOpts = String(gradleOpts || '')
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)

  if (facts) {
    await convertGradleToFacts({
      bin: String(bin),
      configs: String(configs || ''),
      cwd,
      gradleOpts: parsedGradleOpts,
      ignoreUnresolved: Boolean(ignoreUnresolved),
      verbose: Boolean(verbose),
    })
    return
  }

  await convertGradleToMaven({
    bin: String(bin),
    cwd,
    gradleOpts: parsedGradleOpts,
    verbose: Boolean(verbose),
  })
}
