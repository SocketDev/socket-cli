import path from 'node:path'
import process from 'node:process'

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { convertSbtToFacts } from './convert-sbt-to-facts.mts'
import { convertSbtToMaven } from './convert-sbt-to-maven.mts'
import { resolveSbtInvocation } from './manifest-build-trust.mts'
import { outputManifest } from './output-manifest.mts'
import { REQUIREMENTS_TXT } from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { commonFlags } from '../../flags.mts'
import { defineFlags } from '../../meow.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { cmdFlagValueToArray } from '../../util/process/cmd.mts'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'
import { checkCommandInput } from '../../util/validation/check-input.mts'
import { assertNoNegationPatterns } from '../scan/exclude-paths.mts'
import { excludePathsFlag } from '../scan/reachability-flags.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const logger = getDefaultLogger()

// Flags interface for type safety.
export interface ScalaFlags {
  bin: string | undefined
  excludeConfigs: string | undefined
  facts: boolean | undefined
  ignoreUnresolved: boolean | undefined
  includeConfigs: string | undefined
  out: string | undefined
  pom: boolean | undefined
  sbtOpts: string | undefined
  stdout: boolean | undefined
  trustSocketJson: boolean | undefined
  verbose: boolean | undefined
}

const config = {
  commandName: 'scala',
  description:
    '[beta] Generate a Socket facts file (or `pom.xml` with --pom) from a Scala `build.sbt` project',
  flags: defineFlags({
    ...commonFlags,
    bin: {
      type: 'string',
      description: 'Location of sbt binary to use',
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
    includeConfigs: {
      type: 'string',
      description:
        'When generating facts: comma-separated glob patterns matched against sbt configuration names (case-sensitive; `*`, `?`, and `[...]` wildcards). Only configurations matching at least one pattern are resolved. e.g. `compile,test`. Default: compile,optional,provided,runtime,test',
    },
    excludeConfigs: {
      type: 'string',
      description:
        'When generating facts: comma-separated glob patterns; sbt configurations matching any pattern are skipped (applied after --include-configs)',
    },
    ...excludePathsFlag,
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'When generating facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    out: {
      type: 'string',
      description:
        'Only with --pom: path of the output `pom.xml`, see also --stdout. Does not apply when generating Socket facts (always written to the project root as `.socket.facts.json`)',
    },
    stdout: {
      type: 'boolean',
      description:
        'Only with --pom: print the resulting `pom.xml` to stdout (supersedes --out). Does not apply when generating Socket facts',
    },
    sbtOpts: {
      type: 'string',
      description: 'Additional options to pass on to sbt, as per `sbt --help`',
    },
    trustSocketJson: {
      type: 'boolean',
      default: false,
      description: `Run the binary and options declared in ${SOCKET_JSON}. Off by default because the scanned repository controls that file.`,
    },
    verbose: {
      type: 'boolean',
      description: 'Print debug messages',
    },
  }),
  help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(helpConfig.flags)}

    By default, emits a single \`.socket.facts.json\` describing the resolved
    dependency graph of your sbt build, using the bundled sbt plugin. It never
    downloads artifacts; an unresolved dependency is a fatal error. You can pass
    --include-configs / --exclude-configs (comma-separated glob patterns) to
    control which configurations are resolved, and --ignore-unresolved to warn
    on unresolved dependencies instead of failing.

    The default binary is the \`sbt\` on your PATH. A ${SOCKET_JSON} that points
    \`bin\` somewhere else, or that sets \`sbtOpts\`, is refused unless you pass
    --trust-socket-json: those values choose what gets executed and the
    repository being scanned owns that file. Pass --bin and --sbt-opts yourself
    to override the defaults without trusting ${SOCKET_JSON}.

    Pass --pom to instead generate a \`pom.xml\` via \`sbt makePom\` from your
    \`build.sbt\`. This xml file is the dependency manifest (like a package.json
    for Node.js or ${REQUIREMENTS_TXT} for PyPi), but specifically for Scala.
    Caveats of the \`build.sbt\` to \`pom.xml\` conversion:

    - the xml is exported as pom.xml at the project root so Socket scan picks
      it up, but it will first hit your /target/sbt<version> folder (as a
      different name). Use --out to override if you already have a
      hand-authored pom.xml at the project root.

    - the pom.xml format (standard by Scala) does not support certain sbt features
      - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
      - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

    - it uses your sbt settings and local configuration verbatim

    - it can only export one target per run, so if you have multiple targets like
      development and production, you must run them separately.

    Support is beta. Please report issues or give us feedback on what's missing.

    This is only for SBT. If your Scala setup uses gradle, please see the help
    sections for \`socket manifest gradle\` or \`socket cdxgen\`.

    Examples

      $ ${command} .
      $ ${command} --pom .
      $ ${command} ./proj --bin=/usr/bin/sbt
  `,
  hidden: false,
}

export const cmdManifestScala = {
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

  const { json = false, markdown = false } = cli.flags

  const dryRun = cli.flags['dryRun']

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // Feature request: Pass outputKind to convertSbtToMaven for json/md output support.
  const outputKind = getOutputKind(json, markdown)

  const sockJson = readOrDefaultSocketJson(cwd)

  debug(
    `override: ${SOCKET_JSON} sbt: ${JSON.stringify(sockJson?.defaults?.manifest?.sbt)}`,
  )

  const { bin: binFlag, sbtOpts: sbtOptsFlag, trustSocketJson } = cli.flags

  let {
    excludeConfigs,
    facts,
    ignoreUnresolved,
    includeConfigs,
    out,
    stdout,
    verbose,
  } = cli.flags

  // The bin and its options choose what gets executed, so they route through
  // the socket.json trust gate. The remaining socket.json defaults below only
  // shape the emitted facts / pom output and are honored untrusted.
  const invocation = resolveSbtInvocation({
    cliBin: binFlag,
    cliOpts: sbtOptsFlag,
    cwd,
    socketJson: sockJson,
    trustSocketJson,
  })
  if (!invocation.ok) {
    await outputManifest(invocation, outputKind, '-')
    return
  }

  const { bin, opts: sbtOpts } = invocation.data

  if (facts === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.facts !== undefined) {
      facts = sockJson.defaults?.manifest?.sbt?.facts
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
  if (includeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.includeConfigs !== undefined) {
      includeConfigs = sockJson.defaults?.manifest?.sbt?.includeConfigs
      logger.info(
        `Using default --include-configs from ${SOCKET_JSON}:`,
        includeConfigs,
      )
    } else {
      includeConfigs = ''
    }
  }
  if (excludeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.sbt?.excludeConfigs !== undefined) {
      excludeConfigs = sockJson.defaults?.manifest?.sbt?.excludeConfigs
      logger.info(
        `Using default --exclude-configs from ${SOCKET_JSON}:`,
        excludeConfigs,
      )
    } else {
      excludeConfigs = ''
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
  if (
    verbose === undefined &&
    sockJson.defaults?.manifest?.sbt?.verbose !== undefined
  ) {
    verbose = sockJson.defaults?.manifest?.sbt?.verbose
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
  } else if (verbose === undefined) {
    verbose = false
  }

  // `--include-configs`, `--exclude-configs`, and `--ignore-unresolved` only
  // affect facts generation; the pom path (`sbt makePom`) has no equivalent
  // knobs. Warn rather than silently ignore an explicitly-passed flag. A
  // socket.json default does not trip this — only a flag actually present on
  // the command line does.
  if (
    !facts &&
    (cli.flags['includeConfigs'] !== undefined ||
      cli.flags['excludeConfigs'] !== undefined ||
      cli.flags['ignoreUnresolved'] !== undefined)
  ) {
    logger.warn(
      'The `--include-configs`, `--exclude-configs`, and `--ignore-unresolved` options only apply when generating Socket facts (not with `--pom`); ignoring them.',
    )
  }

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.groupEnd()
  }

  // Note: stdin input not supported. SBT manifest generation requires a directory
  // context with build files (build.sbt, project/, etc.) that can't be meaningfully
  // provided via stdin.

  // --out / --stdout only affect the pom path. Socket facts are always written
  // to the project root as `.socket.facts.json` so that `socket scan create`
  // picks them up, so reject these flags in facts mode rather than silently
  // ignoring an explicitly-passed output location.
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
      test: !(
        facts &&
        (cli.flags['out'] !== undefined || cli.flags['stdout'] !== undefined)
      ),
      message:
        'The `--out` and `--stdout` options only apply with `--pom`; Socket facts are always written to the project root as `.socket.facts.json`',
      fail: 'remove --out/--stdout, or pass --pom',
    },
  )
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
    const args = [cwd, '--bin', bin]
    if (out) {
      args.push('--out', out)
    }
    if (sbtOpts.length) {
      args.push('--sbt-opts', sbtOpts.join(' '))
    }
    outputDryRunExecute(
      'sbt',
      args,
      facts
        ? 'generate .socket.facts.json from Scala project'
        : 'generate pom.xml from Scala project',
    )
    return
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertNoNegationPatterns(excludePaths)

  if (facts) {
    await convertSbtToFacts({
      bin,
      cwd,
      excludeConfigs: excludeConfigs || '',
      excludePaths,
      ignoreUnresolved: ignoreUnresolved,
      includeConfigs: includeConfigs || '',
      sbtOpts,
      verbose: verbose,
    })
    return
  }

  const result = await convertSbtToMaven({
    bin,
    cwd,
    out: out,
    outputKind,
    sbtOpts,
    verbose: verbose,
  })

  // In text mode, output is already handled by convertSbtToMaven.
  // For json/markdown modes, we need to call the output helper.
  if (outputKind !== 'text') {
    await outputManifest(result, outputKind, out)
  }
}
