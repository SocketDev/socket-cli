import path from 'node:path'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { extractBazelToMaven } from './extract_bazel_to_maven.mts'
import constants, { SOCKET_JSON } from '../../../constants.mts'
import { commonFlags } from '../../../flags.mts'
import { checkCommandInput } from '../../../utils/check-input.mts'
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
    '[beta] Bazel JVM SBOM support — generate manifest files (`maven_install.json`) for a Bazel/Maven project',
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
      description:
        'Bazel --output_base for read-only-cache CI environments',
    },
    bazelRc: {
      type: 'string',
      description: 'Path to additional .bazelrc fragments forwarded to bazel',
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

    [beta] Generates Bazel JVM SBOM manifests (\`maven_install.json\`-shaped)
    by running \`bazel query\` against discovered Maven repos. Output is
    consumed by \`socket scan create\`'s server-side parser.

    Note: this command generates Maven dependency manifests for Bazel JVM
    workspaces. It does not run reachability analysis.

    To generate AND upload in one step, use \`socket scan create --auto-manifest\`
    instead — it detects Bazel workspaces, runs the same extraction, and uploads
    the result. This subcommand is for generation only.

    Examples
      $ ${command} .
      $ ${command} --bazel=/usr/local/bin/bazelisk .
  `,
}

export const cmdManifestBazel = {
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
    `override: ${SOCKET_JSON} bazel`,
    sockJson?.defaults?.manifest?.bazel,
  )

  let { bazel, bazelFlags, bazelOutputBase, bazelRc, out, verbose } = cli.flags

  // Set defaults for any flag/arg that is not given. Check socket.json first.
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

  await extractBazelToMaven({
    bazelFlags: bazelFlags as string | undefined,
    bazelOutputBase: bazelOutputBase as string | undefined,
    bazelRc: bazelRc as string | undefined,
    bin: bazel as string | undefined,
    cwd,
    out: out as string,
    verbose: Boolean(verbose),
  })
}
