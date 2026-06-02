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

// TODO: We may want to dedupe some pieces for all gradle languages. I think it
//       makes sense to have separate commands for them and I think it makes
//       sense for the help panels to note the requested language, rather than
//       `socket manifest kotlin` to print help screens with `gradle` as the
//       command. Room for improvement.
const config: CliCommandConfig = {
  commandName: 'kotlin',
  description:
    '[beta] Generate a Socket facts file (or `pom.xml` with --pom) for a Kotlin project',
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
        'Emit a Socket facts JSON file (`.socket.facts.json`) describing the resolved dependency graph. This is the default; pass `--pom` to generate `pom.xml` files instead',
    },
    pom: {
      type: 'boolean',
      description:
        'Generate `pom.xml` manifest file(s) instead of the default Socket facts file (`.socket.facts.json`)',
    },
    configs: {
      type: 'string',
      description:
        'With --facts: comma-separated glob patterns matched against Gradle configuration names (case-sensitive, `*` and `?` wildcards). e.g. `*CompileClasspath,*RuntimeClasspath` to skip tooling configs. Default: every resolvable configuration except AGP instrumented-test classpaths',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'With --facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
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

    By default, emits a single \`.socket.facts.json\` describing the resolved
    dependency graph of the whole build, using gradle (preferably your local
    \`gradlew\`). An unresolved dependency is a fatal error. You can pass
    --configs=<comma-separated glob patterns> to restrict resolution to matching
    configurations (e.g. \`*CompileClasspath,*RuntimeClasspath\`), and
    --ignore-unresolved to warn on unresolved dependencies instead of failing.

    Pass --pom to instead generate \`pom.xml\` manifest files via gradle (one per
    task). The \`pom.xml\` is a manifest file similar to \`package.json\` for npm
    (or ${REQUIREMENTS_TXT} for PyPi), but specifically for Maven, which is
    Java's dependency repository. Caveats of the \`pom.xml\` conversion:

    - each task generates its own xml file (one per task by default)

    - certain features may not translate well into the xml; reach out if
      something you need is missing

    - it works with your \`gradlew\` from your repo and local settings and config

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --pom .
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
      // Socket facts generation is the default; pass --pom to generate poms.
      facts = true
    }
  }
  // --pom opts into legacy pom.xml generation. It overrides the facts default
  // (and the socket.json default) but conflicts with an explicit --facts.
  if (cli.flags['pom']) {
    if (cli.flags['facts'] !== undefined) {
      logger.warn(
        'The `--facts` and `--pom` options are mutually exclusive; generating Socket facts.',
      )
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
