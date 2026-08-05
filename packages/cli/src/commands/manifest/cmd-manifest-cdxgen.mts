/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/sort-source-methods -- `arrayToLower` / `toLower` helpers are kept together at the top, alphabetical anchor for the cdxgen flag mapping below; `run` is the command entry point and lives near its config + cmdManifestCdxgen export, not interleaved with helpers. */
import terminalLink from 'terminal-link'
import yargsParse from 'yargs-parser'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { debugNs } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isPath } from '@socketsecurity/lib-stable/paths/normalize'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

import {
  describeCdxgenSource,
  formatCdxgenFailureMessage,
} from '../../util/dlx/cdxgen-diagnostics.mts'
import {
  detectNodejsCdxgenSources,
  isNodejsCdxgenType,
  runCdxgen,
} from './run-cdxgen.mts'
import { FLAG_HELP } from '../../constants/cli.mjs'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { filterFlags, isHelpFlag } from '../../util/process/cmd.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

// Flags interface for type safety.
export interface CdxgenFlags {
  dryRun: boolean
}

// Technical debt: cdxgen uses yargs for arg parsing internally. Converting to
// Socket CLI's custom meow implementation would provide consistency with other
// commands but requires significant work to map all cdxgen flags and maintain
// compatibility with cdxgen's complex option structure.
export function arrayToLower(arg: string[]): string[] {
  return arg.map(toLower)
}
export function toLower(arg: string): string {
  return arg.toLowerCase()
}

// The yargsConfig below re-declares cdxgen's own parser, pinned to v11.2.7, so
// the two must agree flag for flag. A flag that changes TYPE upstream (boolean
// vs string vs array) does not error when our copy disagrees. It parses to the
// wrong shape and surfaces later as a malformed SBOM.
// Frozen `--help` for the pinned version, and how to refresh it:
// docs/references/repo/cdxgen-flag-surface.md

// isSecureMode defined at:
// https://github.com/CycloneDX/cdxgen/blob/v11.2.7/lib/helpers/utils.js#L66
// const isSecureMode =
//   ['true', '1'].includes(process.env?.CDXGEN_SECURE_MODE) ||
//   process.env?.NODE_OPTIONS?.includes('--permission')

// Yargs CDXGEN configuration defined at:
// https://github.com/CycloneDX/cdxgen/blob/v11.2.7/bin/cdxgen.js#L64
const yargsConfig = {
  alias: {
    help: ['h'],
    output: ['o'],
    print: ['p'],
    recurse: ['r'],
    'resolve-class': ['c'],
    type: ['t'],
    version: ['v'],
  },
  array: [
    { key: 'author', type: 'string' },
    { key: 'exclude', type: 'string' },
    { key: 'exclude-type', type: 'string' },
    { key: 'feature-flags', type: 'string' }, // hidden
    { key: 'filter', type: 'string' },
    { key: 'only', type: 'string' },
    { key: 'standard', type: 'string' },
    { key: 'technique', type: 'string' },
    { key: 'type', type: 'string' },
  ],
  boolean: [
    'auto-compositions',
    'babel',
    'banner', // hidden
    'deep',
    'evidence',
    'export-proto',
    'fail-on-error',
    'generate-key-and-sign',
    'help',
    'include-crypto',
    'include-formulation',
    'install-deps',
    'json-pretty',
    'print',
    'recurse',
    'required-only',
    'resolve-class',
    'skip-dt-tls-check',
    'server',
    'validate',
    'version',
  ],
  coerce: {
    'exclude-type': arrayToLower,
    'feature-flags': arrayToLower,
    filter: arrayToLower,
    only: arrayToLower,
    profile: toLower,
    standard: arrayToLower,
    technique: arrayToLower,
    type: arrayToLower,
  },
  configuration: {
    'camel-case-expansion': false,
    'greedy-arrays': false,
    'parse-numbers': false,
    'populate--': true,
    'short-option-groups': false,
    'strip-aliased': true,
    'unknown-options-as-args': true,
  },
  default: {
    type: ['js'],
  },
  string: [
    'api-key',
    'data-flow-slices-file', // hidden
    'deps-slices-file', // hidden
    'evinse-output', // hidden
    'lifecycle',
    'min-confidence', // number
    'openapi-spec-file', // hidden
    'output',
    'parent-project-id',
    'profile',
    'project-group',
    'project-name',
    'project-version',
    'project-id',
    'proto-bin-file',
    'reachables-slices-file', // hidden
    'semantics-slices-file', // hidden
    'server-host',
    'server-port',
    'server-url',
    'spec-version', // number
    'usages-slices-file', // hidden
  ],
}

const config = {
  commandName: 'cdxgen',
  description: 'Run cdxgen for SBOM generation',
  // Stub out flags and help since cdxgen uses yargs internally.
  // Socket CLI uses custom meow - see note above about conversion complexity.
  flags: {},
  help: () => '',
  hidden: false,
}

export const cmdManifestCdxgen = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext
  const cli = meowOrExit({
    // Don't let meow take over --help.
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  const { dryRun } = cli.flags

  // Filter Socket flags from argv but keep --no-banner and --help for cdxgen.
  const argsToProcess = filterFlags(argv, { ...commonFlags, ...outputFlags }, [
    '--no-banner',
    FLAG_HELP,
    '-h',
  ])
  const yargv = {
    ...yargsParse(argsToProcess, yargsConfig),
    // eslint-disable-next-line typescript-eslint/no-explicit-any -- yargs-parser returns a dynamic flag bag; downstream code reads .help/.lifecycle/.output/.type/_/--.
  } as any

  const pathArgs: string[] = []
  const unknowns: string[] = []
  const positionals = yargv._ as string[]
  for (let i = 0, { length } = positionals; i < length; i += 1) {
    const a = positionals[i]!
    if (isPath(a)) {
      pathArgs.push(a)
    } else {
      unknowns.push(a)
    }
  }

  yargv._ = pathArgs

  const { length: unknownsCount } = unknowns
  if (unknownsCount) {
    // Use exit status of 2 to indicate incorrect usage, generally invalid
    // options or missing arguments.
    // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
    process.exitCode = 2
    logger.fail(
      `Unknown ${pluralize('argument', { count: unknownsCount })}: ${joinAnd(unknowns)}`,
    )
    return
  }

  if (dryRun) {
    const cdxgenArgs = argsToProcess.filter(
      arg => arg !== '--dry-run' && !arg.startsWith('--dry-run='),
    )
    outputDryRunExecute('cdxgen', cdxgenArgs, 'SBOM generation')
    return
  }

  // Change defaults when not passing the --help flag.
  if (!yargv.help) {
    // Make 'lifecycle' default to 'pre-build', which also sets 'install-deps' to `false`,
    // to avoid arbitrary code execution on the cdxgen scan.
    // https://github.com/CycloneDX/cdxgen/issues/1328
    const lifecycleWasDefaulted = yargv.lifecycle === undefined
    if (lifecycleWasDefaulted) {
      yargv.lifecycle = 'pre-build'
      yargv['install-deps'] = false
      logger.info(
        `Setting cdxgen --lifecycle to "${yargv.lifecycle}" to avoid arbitrary code execution on this scan.\n  Pass "--lifecycle build" to generate a BOM consisting of information obtained during the build process.\n  See cdxgen ${terminalLink(
          'BOM lifecycles documentation',
          'https://cyclonedx.github.io/cdxgen/#/ADVANCED?id=bom-lifecycles',
        )} for more details.\n`,
      )
    }
    if (yargv.output === undefined) {
      yargv.output = 'socket-cdx.json'
    }

    // Hard gate: in the default pre-build + install-deps=false path, cdxgen
    // needs either a lockfile or an installed node_modules/ to produce any
    // Node.js components. Without both, it emits a valid CycloneDX doc with
    // "components": []. Refuse with an actionable error instead of shipping
    // an empty SBOM.
    if (
      lifecycleWasDefaulted &&
      isNodejsCdxgenType(yargv.type) &&
      !yargv['filter'] &&
      !yargv['only']
    ) {
      const { hasLockfile, hasNodeModules } = await detectNodejsCdxgenSources()
      if (!hasLockfile && !hasNodeModules) {
        process.exitCode = 2
        logger.fail(
          `socket cdxgen found no lockfile (pnpm-lock.yaml / package-lock.json / yarn.lock) or node_modules/ at or above ${process.cwd()}.\n` +
            '  The default --lifecycle pre-build with --no-install-deps needs one of them to resolve components; otherwise the SBOM ships with "components": [].\n' +
            '  Fix: install dependencies first (e.g. `npm install`, `pnpm install`, `yarn install`), or re-run with `--lifecycle build` to let cdxgen resolve during the build.',
        )
        return
      }
    }
  }

  // Assume failure until cdxgen reports otherwise, so an unexpected early exit
  // cannot be mistaken for a successful scan.
  process.exitCode = 1

  let result
  try {
    const { spawnPromise } = await runCdxgen(yargv)
    result = await spawnPromise
  } catch (e) {
    // cdxgen runs with stdio: 'inherit', so a failure to start it produces no
    // child output at all. Say where we looked and what to try next.
    // The message tells the user to re-run with SOCKET_CLI_DEBUG=1, so put the
    // underlying error on the 'error' category that flag turns on. Handling it
    // here means it never reaches the top level, and nothing else on this path
    // logs it, so without this the advice would lead nowhere.
    debugNs('error', `cdxgen failed to run while ${describeCdxgenSource()}`, e)
    logger.fail(formatCdxgenFailureMessage(e))
    return
  }

  if (result.signal) {
    process.kill(process.pid, result.signal)
  } else if (typeof result.code === 'number') {
    process.exit(result.code)
  } else {
    // Neither an exit code nor a signal. Without this branch the command
    // returns here with the exit code armed above and prints nothing at all.
    // There is no error to show, so the spawn result is what SOCKET_CLI_DEBUG=1
    // has to offer.
    debugNs('error', 'cdxgen returned no exit code and no signal', result)
    logger.fail(formatCdxgenFailureMessage())
  }
}
