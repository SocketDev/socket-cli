import path from 'node:path'
import process from 'node:process'

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { convertGradleToFacts } from './convert-gradle-to-facts.mts'
import { convertGradleToMaven } from './convert-gradle-to-maven.mts'
import { resolveGradleInvocation } from './manifest-build-trust.mts'
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
export interface KotlinFlags {
  bin: string | undefined
  excludeConfigs: string | undefined
  facts: boolean | undefined
  gradleOpts: string | undefined
  ignoreUnresolved: boolean | undefined
  includeConfigs: string | undefined
  pom: boolean | undefined
  trustSocketJson: boolean | undefined
  verbose: boolean | undefined
}

// Design note: Gradle language commands, gradle, kotlin, scala, share similar code
// but maintain separate commands for clarity. This allows language-specific help text
// and clearer user experience (e.g., "socket manifest kotlin" shows Kotlin-specific
// help rather than generic gradle help). Future refactoring could extract shared logic
// while preserving separate command interfaces.
const config = {
  commandName: 'kotlin',
  description:
    '[beta] Generate a Socket facts file (or `pom.xml` with --pom) for a Kotlin project',
  flags: defineFlags({
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
    includeConfigs: {
      type: 'string',
      description:
        'When generating facts: comma-separated glob patterns matched against Gradle configuration names (case-sensitive; `*`, `?`, and `[...]` wildcards). Only configurations matching at least one pattern are resolved. e.g. `*CompileClasspath,*RuntimeClasspath`. Default: every resolvable configuration',
    },
    excludeConfigs: {
      type: 'string',
      description:
        'When generating facts: comma-separated glob patterns; Gradle configurations matching any pattern are skipped (applied after --include-configs)',
    },
    ...excludePathsFlag,
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'When generating facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    gradleOpts: {
      type: 'string',
      description:
        'Additional options to pass on to ./gradlew, see `./gradlew --help`',
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
    dependency graph of the whole build, using gradle (preferably your local
    \`gradlew\`). An unresolved dependency is a fatal error. You can pass
    --include-configs / --exclude-configs (comma-separated glob patterns) to
    control which configurations are resolved (e.g.
    --include-configs=\`*CompileClasspath,*RuntimeClasspath\`), and
    --ignore-unresolved to warn on unresolved dependencies instead of failing.

    The default binary is \`CWD/gradlew\`. A ${SOCKET_JSON} that points \`bin\`
    somewhere else, or that sets \`gradleOpts\`, is refused unless you pass
    --trust-socket-json: those values choose what gets executed and the
    repository being scanned owns that file. Pass --bin and --gradle-opts
    yourself to override the defaults without trusting ${SOCKET_JSON}.

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
  hidden: false,
}

export const cmdManifestKotlin = {
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

  // Feature request: Pass outputKind to convertGradleToMaven for json/md output support.
  const outputKind = getOutputKind(json, markdown)

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const sockJson = readOrDefaultSocketJson(cwd)

  debug(
    `override: ${SOCKET_JSON} gradle: ${JSON.stringify(sockJson?.defaults?.manifest?.gradle)}`,
  )

  const {
    bin: binFlag,
    gradleOpts: gradleOptsFlag,
    trustSocketJson,
  } = cli.flags

  let { excludeConfigs, facts, ignoreUnresolved, includeConfigs, verbose } =
    cli.flags

  // The bin and its options choose what gets executed, so they route through
  // the socket.json trust gate. The remaining socket.json defaults below only
  // shape the emitted facts and are honored untrusted.
  const invocation = resolveGradleInvocation({
    cliBin: binFlag,
    cliOpts: gradleOptsFlag,
    cwd,
    socketJson: sockJson,
    trustSocketJson,
  })
  if (!invocation.ok) {
    await outputManifest(invocation, outputKind, '-')
    return
  }

  const { bin, opts: gradleOpts } = invocation.data

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
  if (includeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.includeConfigs !== undefined) {
      includeConfigs = sockJson.defaults?.manifest?.gradle?.includeConfigs
      logger.info(
        `Using default --include-configs from ${SOCKET_JSON}:`,
        includeConfigs,
      )
    } else {
      includeConfigs = ''
    }
  }
  if (excludeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.gradle?.excludeConfigs !== undefined) {
      excludeConfigs = sockJson.defaults?.manifest?.gradle?.excludeConfigs
      logger.info(
        `Using default --exclude-configs from ${SOCKET_JSON}:`,
        excludeConfigs,
      )
    } else {
      excludeConfigs = ''
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

  // `--include-configs`, `--exclude-configs`, and `--ignore-unresolved` only
  // affect facts generation; the pom path has no equivalent knobs. Warn rather
  // than silently ignore an explicitly-passed flag. A socket.json default does
  // not trip this — only a flag actually present on the command line does.
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
    const args = [cwd, '--bin', bin]
    if (gradleOpts.length) {
      args.push('--gradle-opts', gradleOpts.join(' '))
    }
    outputDryRunExecute(
      'gradlew',
      args,
      facts
        ? 'generate .socket.facts.json from Kotlin project'
        : 'generate pom.xml from Kotlin project',
    )
    return
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertNoNegationPatterns(excludePaths)

  if (facts) {
    await convertGradleToFacts({
      bin,
      cwd,
      excludeConfigs: String(excludeConfigs || ''),
      excludePaths,
      gradleOpts,
      ignoreUnresolved: Boolean(ignoreUnresolved),
      includeConfigs: String(includeConfigs || ''),
      verbose: Boolean(verbose),
    })
    return
  }

  const result = await convertGradleToMaven({
    bin,
    cwd,
    gradleOpts,
    outputKind,
    verbose: Boolean(verbose),
  })

  // In text mode, output is already handled by convertGradleToMaven.
  // For json/markdown modes, we need to call the output helper.
  if (outputKind !== 'text') {
    await outputManifest(result, outputKind, '-')
  }
}
