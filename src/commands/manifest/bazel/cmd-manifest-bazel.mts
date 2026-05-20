import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './extract_bazel_to_maven.mts'
import { extractBazelToPypi } from './extract_bazel_to_pypi.mts'
import constants, { SOCKET_JSON } from '../../../constants.mts'
import { commonFlags } from '../../../flags.mts'
import { checkCommandInput } from '../../../utils/check-input.mts'
import { InputError } from '../../../utils/errors.mts'
import { getOutputKind } from '../../../utils/get-output-kind.mts'
import { meowOrExit } from '../../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../../utils/output-formatting.mts'
import { readOrDefaultSocketJson } from '../../../utils/socket-json.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'bazel',
  description:
    '[beta] Bazel SBOM support — generate manifest files for a Bazel project (Maven, PyPI)',
  hidden: false,
  flags: {
    ...commonFlags,
    bazel: {
      type: 'string',
      description:
        'Path to bazel/bazelisk binary; default: $(which bazelisk) || $(which bazel)',
    },
    bazelFlags: {
      type: 'string',
      description:
        'Flags forwarded to every bazel invocation (single quoted string)',
    },
    bazelOutputBase: {
      type: 'string',
      description: 'Bazel --output_base for read-only-cache CI environments',
    },
    bazelRc: {
      type: 'string',
      description: 'Path to additional .bazelrc fragments forwarded to bazel',
    },
    ecosystem: {
      type: 'string',
      isMultiple: true,
      description:
        'Ecosystem(s) to extract; repeatable. Supported: maven, pypi. Default: auto-detect all supported ecosystems.',
    },
    out: {
      type: 'string',
      description:
        'Output directory for generated manifests; default: ./.socket/bazel-manifests/',
    },
    verbose: {
      type: 'boolean',
      description: 'Stream bazel stdout/stderr',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    [beta] Generates Bazel SBOM manifests for Maven (\`maven_install.json\`)
    and PyPI (\`requirements.txt\`) by running \`bazel query\` against
    discovered dependency repos. Output is consumed by
    \`socket scan create\`'s server-side parser.

    --ecosystem may be repeated to select which ecosystems to extract.
    When omitted, all detected ecosystems are generated automatically.

    Note: this command generates dependency manifests for Bazel workspaces.
    It does not run reachability analysis.

    To generate AND upload in one step, use \`socket scan create --auto-manifest\`
    instead — it detects Bazel workspaces, runs the same extraction, and uploads
    the result. This subcommand is for generation only.

    Examples
      $ ${command} .
      $ ${command} --ecosystem pypi .
      $ ${command} --ecosystem maven --ecosystem pypi .
      $ ${command} --bazel=/usr/local/bin/bazelisk .
  `,
}

export const cmdManifestBazel = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export type EcosystemOutcome = {
  ecosystem: 'maven' | 'pypi'
  ok: boolean
  noEcosystemFound?: boolean | undefined
  hardFailure?: boolean
  manifestPath?: string | undefined
}

// Pure outcome-matrix evaluator. Exported so dispatcher behavior can be
// unit-tested without spawning the CLI binary. Throws InputError on
// failures that must propagate to a non-zero CLI exit; returns void on
// success.
//
// - Hard failure: ok === false && !noEcosystemFound. The ecosystem was
//   detected (or the runner crashed), but extraction failed. Always a
//   non-zero exit, even when another ecosystem succeeded.
// - No-discovery: noEcosystemFound === true. Genuinely absent ecosystem.
//   Auto-detect mode tolerates this when at least one other ecosystem
//   succeeded; explicit mode treats it as an error.
export function evaluateEcosystemOutcomes(
  outcomes: readonly EcosystemOutcome[],
  isExplicit: boolean,
): void {
  const hardFailures = outcomes.filter(o => !o.ok && !o.noEcosystemFound)
  const noDiscoveries = outcomes.filter(o => o.noEcosystemFound)
  const successes = outcomes.filter(o => o.ok && o.manifestPath)

  if (!isExplicit) {
    if (hardFailures.length) {
      throw new InputError(
        `Bazel auto-manifest generation hit hard failure(s) in ecosystem(s): ${hardFailures.map(f => f.ecosystem).join(', ')}.`,
      )
    }
    if (successes.length) {
      return
    }
    if (noDiscoveries.length === outcomes.length) {
      throw new InputError(
        'No supported Bazel ecosystems detected (maven, pypi). Ensure rules_jvm_external, rules_python pip_parse/pip_install/pip_repository, or pip.parse is configured.',
      )
    }
    return
  }

  // Explicit mode: every requested ecosystem must succeed.
  if (noDiscoveries.length) {
    throw new InputError(
      `No Bazel rules found for explicitly requested ecosystem(s): ${noDiscoveries.map(f => f.ecosystem).join(', ')}.`,
    )
  }
  if (hardFailures.length) {
    throw new InputError(
      `Bazel manifest generation failed for explicitly requested ecosystem(s): ${hardFailures.map(f => f.ecosystem).join(', ')}.`,
    )
  }
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
    `override: ${SOCKET_JSON} bazel`,
    sockJson?.defaults?.manifest?.bazel,
  )

  let { bazel, bazelFlags, bazelOutputBase, bazelRc, ecosystem, out, verbose } =
    cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
  // The meow flag is isMultiple: true, so cli.flags.ecosystem is
  // string[] | undefined. The SocketJson schema allows either a single
  // string or an array, so normalize a string default to a one-element
  // array before assigning.
  if (!ecosystem) {
    const rawEcosystem = sockJson.defaults?.manifest?.bazel?.ecosystem
    if (rawEcosystem) {
      ecosystem = Array.isArray(rawEcosystem)
        ? [...rawEcosystem]
        : [rawEcosystem as string]
      logger.info(`Using default --ecosystem from ${SOCKET_JSON}:`, ecosystem)
    }
  }
  if (!bazel) {
    const defaultBazel =
      sockJson.defaults?.manifest?.bazel?.bazel ??
      sockJson.defaults?.manifest?.bazel?.bin
    if (defaultBazel) {
      bazel = defaultBazel
      logger.info(`Using default --bazel from ${SOCKET_JSON}:`, bazel)
    }
    // Otherwise leave undefined; resolveBazelBinary performs the PATH
    // lookup for bazelisk/bazel.
  }
  if (!bazelFlags) {
    if (sockJson.defaults?.manifest?.bazel?.bazelFlags) {
      bazelFlags = sockJson.defaults?.manifest?.bazel?.bazelFlags
      logger.info(
        `Using default --bazel-flags from ${SOCKET_JSON}:`,
        bazelFlags,
      )
    } else {
      bazelFlags = ''
    }
  }
  if (!bazelOutputBase) {
    if (sockJson.defaults?.manifest?.bazel?.bazelOutputBase) {
      bazelOutputBase = sockJson.defaults?.manifest?.bazel?.bazelOutputBase
      logger.info(
        `Using default --bazel-output-base from ${SOCKET_JSON}:`,
        bazelOutputBase,
      )
    }
  }
  if (!bazelRc) {
    if (sockJson.defaults?.manifest?.bazel?.bazelRc) {
      bazelRc = sockJson.defaults?.manifest?.bazel?.bazelRc
      logger.info(`Using default --bazel-rc from ${SOCKET_JSON}:`, bazelRc)
    }
  }
  if (!out) {
    if (sockJson.defaults?.manifest?.bazel?.out) {
      out = sockJson.defaults?.manifest?.bazel?.out
      logger.info(`Using default --out from ${SOCKET_JSON}:`, out)
    } else {
      out = path.join(cwd, '.socket', 'bazel-manifests')
    }
  }
  if (verbose === undefined) {
    if (sockJson.defaults?.manifest?.bazel?.verbose !== undefined) {
      verbose = sockJson.defaults?.manifest?.bazel?.verbose
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
    logger.info('- bazel bin:', bazel)
    logger.info('- out:', out)
    logger.groupEnd()
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  // Ecosystem dispatch: auto-detect both maven and pypi when no --ecosystem
  // flag is given; otherwise validate and dispatch to the requested ecosystems.
  const wasExplicitEcosystemSelection =
    Array.isArray(ecosystem) && ecosystem.length > 0
  const ecosystems: string[] =
    wasExplicitEcosystemSelection ? (ecosystem as string[]) : ['maven', 'pypi']

  for (const eco of ecosystems) {
    if (!['maven', 'pypi'].includes(eco)) {
      throw new InputError(
        `Unsupported --ecosystem value: ${eco}. Supported values: maven, pypi.`,
      )
    }
  }

  const outcomes: EcosystemOutcome[] = []

  for (const eco of ecosystems) {
    if (eco === 'maven') {
      const mavenResult = await extractBazelToMaven({
        bazelFlags: bazelFlags as string | undefined,
        bazelOutputBase: bazelOutputBase as string | undefined,
        bazelRc: bazelRc as string | undefined,
        bin: bazel as string | undefined,
        cwd,
        out: out as string,
        verbose: Boolean(verbose),
      })
      outcomes.push({
        ecosystem: 'maven',
        ok: mavenResult.ok,
        manifestPath: mavenResult.manifestPath,
      })
    } else if (eco === 'pypi') {
      const pypiResult = await extractBazelToPypi({
        bazelFlags: bazelFlags as string | undefined,
        bazelOutputBase: bazelOutputBase as string | undefined,
        bazelRc: bazelRc as string | undefined,
        bin: bazel as string | undefined,
        cwd,
        out: out as string,
        verbose: Boolean(verbose),
        explicitEcosystem: wasExplicitEcosystemSelection,
      })
      outcomes.push({
        ecosystem: 'pypi',
        ok: pypiResult.ok,
        noEcosystemFound: pypiResult.noEcosystemFound,
        manifestPath: pypiResult.manifestPath,
      })
    }
  }

  evaluateEcosystemOutcomes(outcomes, wasExplicitEcosystemSelection)
}
