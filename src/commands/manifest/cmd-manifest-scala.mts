import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertSbtToFacts } from './convert-sbt-to-facts.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
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
  commandName: 'scala',
  description:
    "[beta] Generate a manifest file (`pom.xml`) from Scala's `build.sbt` file",
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of sbt binary to use',
    },
    facts: {
      type: 'boolean',
      description:
        'Emit a Socket facts JSON file (`.socket.facts.json`) describing the resolved dependency graph instead of generating `pom.xml` files',
    },
    configs: {
      type: 'string',
      description:
        'With --facts: comma-separated glob patterns matched against sbt configuration names (case-sensitive, `*` and `?` wildcards). Bare names (no wildcards) act as exact-name filters. Default: compile,optional,provided,runtime,test',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'With --facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    out: {
      type: 'string',
      description:
        'Path of output file; where to store the resulting manifest, see also --stdout',
    },
    stdout: {
      type: 'boolean',
      description: 'Print resulting pom.xml to stdout (supersedes --out)',
    },
    sbtOpts: {
      type: 'string',
      description: 'Additional options to pass on to sbt, as per `sbt --help`',
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

    Uses \`sbt makePom\` to generate a \`pom.xml\` from your \`build.sbt\` file.
    This xml file is the dependency manifest (like a package.json
    for Node.js or ${REQUIREMENTS_TXT} for PyPi), but specifically for Scala.

    There are some caveats with \`build.sbt\` to \`pom.xml\` conversion:

    - the xml is exported as pom.xml at the project root so Socket scan picks
      it up; sbt itself first writes it inside your /target/sbt<version> folder
      (as a different name). Use --out to override if you already have a
      hand-authored pom.xml at the project root.

    - the pom.xml format (standard by Scala) does not support certain sbt features
      - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
      - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

    - it uses your sbt settings and local configuration verbatim

    - it can only export one target per run, so if you have multiple targets like
      development and production, you must run them separately.

    You can specify --bin to override the path to the \`sbt\` binary to invoke.

    Pass --facts to instead emit a single \`.socket.facts.json\` describing the
    resolved dependency graph of the whole build (no \`pom.xml\` files). It reads
    dependency metadata only and never downloads artifacts; an unresolved
    dependency is a fatal error. With --facts you can pass
    --configs=<comma-separated glob patterns> to choose which sbt configurations
    to resolve (e.g. \`compile,test\` for exact names or \`*Test*\` for variants),
    and --ignore-unresolved to warn on unresolved dependencies instead of
    failing the run.

    Support is beta. Please report issues or give us feedback on what's missing.

    This is only for SBT. If your Scala setup uses gradle, please see the help
    sections for \`socket manifest gradle\` or \`socket cdxgen\`.

    Examples

      $ ${command}
      $ ${command} --facts .
      $ ${command} ./proj --bin=/usr/bin/sbt --file=boot.sbt
  `,
}

export const cmdManifestScala = {
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

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // TODO: Implement json/md further.
  const outputKind = getOutputKind(json, markdown)

  const sockJson = readOrDefaultSocketJson(cwd)

  debugFn(
    'inspect',
    `override: ${SOCKET_JSON} sbt`,
    sockJson?.defaults?.manifest?.sbt,
  )

  let { bin, configs, facts, ignoreUnresolved, out, sbtOpts, stdout, verbose } =
    cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.sbt?.bin) {
      bin = sockJson.defaults?.manifest?.sbt?.bin
      logger.info(`Using default --bin from ${SOCKET_JSON}:`, bin)
    } else {
      bin = 'sbt'
    }
  }
  if (facts === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.facts !== undefined) {
      facts = sockJson.defaults?.manifest?.sbt?.facts
      logger.info(`Using default --facts from ${SOCKET_JSON}:`, facts)
    } else {
      facts = false
    }
  }
  if (configs === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.configs !== undefined) {
      configs = sockJson.defaults?.manifest?.sbt?.configs
      logger.info(`Using default --configs from ${SOCKET_JSON}:`, configs)
    } else {
      configs = ''
    }
  }
  if (ignoreUnresolved === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.ignoreUnresolved !== undefined) {
      ignoreUnresolved = sockJson.defaults?.manifest?.sbt?.ignoreUnresolved
      logger.info(
        `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
        ignoreUnresolved,
      )
    } else {
      ignoreUnresolved = false
    }
  }
  if (
    stdout === undefined &&
    sockJson.defaults?.manifest?.sbt?.stdout !== undefined
  ) {
    stdout = sockJson.defaults?.manifest?.sbt?.stdout
    logger.info(`Using default --stdout from ${SOCKET_JSON}:`, stdout)
  }
  if (stdout) {
    out = '-'
  } else if (!out) {
    if (sockJson.defaults?.manifest?.sbt?.outfile) {
      out = sockJson.defaults?.manifest?.sbt?.outfile
      logger.info(`Using default --out from ${SOCKET_JSON}:`, out)
    } else {
      out = './pom.xml'
    }
  }
  if (!sbtOpts) {
    if (sockJson.defaults?.manifest?.sbt?.sbtOpts) {
      sbtOpts = sockJson.defaults?.manifest?.sbt?.sbtOpts
      logger.info(`Using default --sbt-opts from ${SOCKET_JSON}:`, sbtOpts)
    } else {
      sbtOpts = ''
    }
  }
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.sbt?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.sbt?.verbose
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
  } else if (verbose === undefined) {
    verbose = false
  }

  // `--configs` and `--ignore-unresolved` only affect --facts; the pom path
  // (`sbt makePom`) has no equivalent knobs. Warn rather than silently ignore
  // an explicitly-passed flag. (socket.json defaults don't trip this — only a
  // flag actually present on the command line does.)
  if (
    !facts &&
    (cli.flags['configs'] !== undefined ||
      cli.flags['ignoreUnresolved'] !== undefined)
  ) {
    logger.warn(
      'The `--configs` and `--ignore-unresolved` options only apply with `--facts`; ignoring them.',
    )
  }

  // Conversely, --out / --stdout only affect the pom path; with --facts the
  // plugin always writes `.socket.facts.json` to the build root (its
  // socket.outputDirectory/outputFile JVM props aren't exposed by the CLI), so
  // warn rather than let `--facts --out custom.json` silently write nothing
  // there.
  if (
    facts &&
    (cli.flags['out'] !== undefined || cli.flags['stdout'] !== undefined)
  ) {
    logger.warn(
      'The `--out` and `--stdout` options do not apply with `--facts`; the facts file is always written to the build root.',
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
    logger.log('- target:', cwd)
    logger.log('- sbt bin:', bin)
    logger.log('- out:', out)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const parsedSbtOpts = String(sbtOpts || '')
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)

  if (facts) {
    await convertSbtToFacts({
      bin: String(bin),
      configs: String(configs || ''),
      cwd,
      ignoreUnresolved: Boolean(ignoreUnresolved),
      sbtOpts: parsedSbtOpts,
      verbose: Boolean(verbose),
    })
    return
  }

  await convertSbtToMaven({
    bin: String(bin),
    cwd,
    out: String(out),
    sbtOpts: parsedSbtOpts,
    verbose: Boolean(verbose),
  })
}
