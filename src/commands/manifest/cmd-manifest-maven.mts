import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertMavenToFacts } from './convert-maven-to-facts.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import constants, { SOCKET_JSON } from '../../constants.mts'
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
  commandName: 'maven',
  description:
    '[beta] Generate a Socket facts file from a Maven `pom.xml` project',
  hidden: false,
  flags: {
    ...commonFlags,
    bin: {
      type: 'string',
      description:
        'Location of the maven binary to use, default: ./mvnw if present, else mvn on PATH',
    },
    includeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns matched against Maven dependency scopes (case-sensitive; `*`, `?`, and `[...]` wildcards). Only scopes matching at least one pattern are resolved. e.g. `compile,runtime`. Default: every scope',
    },
    excludeConfigs: {
      type: 'string',
      description:
        'Comma-separated glob patterns; Maven scopes matching any pattern are skipped (applied after --include-configs)',
    },
    ignoreUnresolved: {
      type: 'boolean',
      description:
        'Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)',
    },
    mavenOpts: {
      type: 'string',
      description:
        'Additional options to pass on to maven, e.g. `-P <profile> -s <settings.xml>`',
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

    Emits a single \`.socket.facts.json\` describing the resolved dependency
    graph of your Maven project, using maven (\`mvn\` on PATH by default). It
    reads dependency metadata only and never downloads artifacts; an unresolved
    dependency is a fatal error. You can pass --include-configs /
    --exclude-configs (comma-separated glob patterns) to control which Maven
    scopes are resolved (e.g. --include-configs=\`compile,runtime\`), and
    --ignore-unresolved to warn on unresolved dependencies instead of failing.

    You can specify --bin to override the path to the \`mvn\` binary to invoke
    (e.g. a project \`./mvnw\` wrapper), and --maven-opts to pass extra options
    through to maven (e.g. \`-P <profile> -s <settings.xml>\`).

    Support is beta. Please report issues or give us feedback on what's missing.

    Examples

      $ ${command} .
      $ ${command} --bin=./mvnw .
      $ ${command} --maven-opts="-P release" .
  `,
}

export const cmdManifestMaven = {
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
    `override: ${SOCKET_JSON} maven`,
    sockJson?.defaults?.manifest?.maven,
  )

  let {
    bin,
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    mavenOpts,
    verbose,
  } = cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  if (!bin) {
    if (sockJson.defaults?.manifest?.maven?.bin) {
      bin = sockJson.defaults?.manifest?.maven?.bin
      logger.info(`Using default --bin from ${SOCKET_JSON}:`, bin)
    } else {
      // Prefer the project's ./mvnw wrapper, else `mvn` on PATH.
      bin = resolveBuildToolBin('maven', cwd)
    }
  }
  if (!mavenOpts) {
    if (sockJson.defaults?.manifest?.maven?.mavenOpts) {
      mavenOpts = sockJson.defaults?.manifest?.maven?.mavenOpts
      logger.info(`Using default --maven-opts from ${SOCKET_JSON}:`, mavenOpts)
    } else {
      mavenOpts = ''
    }
  }
  if (includeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.maven?.includeConfigs !== undefined) {
      includeConfigs = sockJson.defaults?.manifest?.maven?.includeConfigs
      logger.info(
        `Using default --include-configs from ${SOCKET_JSON}:`,
        includeConfigs,
      )
    } else {
      includeConfigs = ''
    }
  }
  if (excludeConfigs === undefined) {
    if (sockJson.defaults?.manifest?.maven?.excludeConfigs !== undefined) {
      excludeConfigs = sockJson.defaults?.manifest?.maven?.excludeConfigs
      logger.info(
        `Using default --exclude-configs from ${SOCKET_JSON}:`,
        excludeConfigs,
      )
    } else {
      excludeConfigs = ''
    }
  }
  if (ignoreUnresolved === undefined) {
    if (sockJson.defaults?.manifest?.maven?.ignoreUnresolved !== undefined) {
      ignoreUnresolved = sockJson.defaults?.manifest?.maven?.ignoreUnresolved
      logger.info(
        `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
        ignoreUnresolved,
      )
    } else {
      ignoreUnresolved = false
    }
  }
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.maven?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.maven?.verbose
      logger.info(`Using default --verbose from ${SOCKET_JSON}:`, verbose)
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
    logger.info('- maven bin:', bin)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const parsedMavenOpts = parseBuildToolOpts(String(mavenOpts || ''))

  await convertMavenToFacts({
    bin: String(bin),
    cwd,
    excludeConfigs: String(excludeConfigs || ''),
    ignoreUnresolved: Boolean(ignoreUnresolved),
    includeConfigs: String(includeConfigs || ''),
    mavenOpts: parsedMavenOpts,
    verbose: Boolean(verbose),
  })
}
