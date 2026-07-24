import { fileURLToPath } from 'node:url'

import {
  isNpmAuditFlag,
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
} from '@socketsecurity/registry/lib/agent'
import { isDebug } from '@socketsecurity/registry/lib/debug'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { ensureIpcInStdio } from './stdio-ipc.mts'
import constants, {
  FLAG_LOGLEVEL,
  NODE_MODULES,
  NPM,
  NPX,
} from '../constants.mts'
import { cmdFlagsToString } from '../utils/cmd.mts'
import { findUp } from '../utils/fs.mts'
import { getPublicApiToken } from '../utils/sdk.mts'
import { installNpmLinks, installNpxLinks } from '../utils/shadow-links.mts'

import type { IpcObject } from '../constants.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

export type ShadowBinOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type ShadowBinResult = {
  spawnPromise: SpawnResult<string, SpawnExtra | undefined>
}

// Length of the '--node-options=' prefix, used to slice the value out of an
// npm '--node-options=<value>' argument.
const NODE_OPTIONS_FLAG_PREFIX_LENGTH = '--node-options='.length

/**
 * Build the '--node-options=<value>' argument passed to npm so its lifecycle
 * scripts run with our Node permission flags.
 *
 * npm assigns this value to NODE_OPTIONS for the scripts it runs, REPLACING any
 * inherited NODE_OPTIONS. To avoid clobbering the user's configuration we merge,
 * in order, the caller's existing process.env.NODE_OPTIONS and any
 * '--node-options=<value>' npm argument ahead of our permission flags (issue
 * #1036).
 *
 * The value is intentionally NOT wrapped in quotes. shadowNpmBase spawns npm
 * without a shell, so any quotes would be passed literally to npm and become
 * part of the NODE_OPTIONS value. Consumers that re-tokenize NODE_OPTIONS on
 * whitespace (e.g. Next.js) then strip the leading quote off '--permission',
 * dropping it while keeping the '--allow-*' flags, which crashes Node >= 24
 * with ERR_MISSING_OPTION (issue #1160).
 */
export function buildNpmNodeOptionsArg(
  envNodeOptions: string | undefined,
  nodeOptionsArg: string | undefined,
  permArgs: string[] | readonly string[],
): string {
  const value = [
    envNodeOptions,
    nodeOptionsArg ? nodeOptionsArg.slice(NODE_OPTIONS_FLAG_PREFIX_LENGTH) : '',
    cmdFlagsToString(permArgs),
  ]
    .filter(Boolean)
    .join(' ')
  return `--node-options=${value}`
}

export default async function shadowNpmBase(
  binName: typeof NPM | typeof NPX,
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowBinResult> {
  const {
    env: spawnEnv,
    ipc,
    ...spawnOpts
  } = { __proto__: null, ...options } as ShadowBinOptions

  let cwd = getOwn(spawnOpts, 'cwd') ?? process.cwd()
  if (cwd instanceof URL) {
    cwd = fileURLToPath(cwd)
  }

  const isShadowNpm = binName === NPM
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const nodeOptionsArg = rawBinArgs.findLast(isNpmNodeOptionsFlag)
  const progressArg = rawBinArgs.findLast(isNpmProgressFlag) !== '--no-progress'
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const permArgs =
    isShadowNpm && constants.SUPPORTS_NODE_PERMISSION_FLAG
      ? [
          '--permission',
          '--allow-child-process',
          // '--allow-addons',
          // '--allow-wasi',
          // Allow all reads because npm walks up directories looking for config
          // and package.json files.
          '--allow-fs-read=*',
          `--allow-fs-write=${cwd}/*`,
          `--allow-fs-write=${constants.npmGlobalPrefix}/*`,
          `--allow-fs-write=${constants.npmCachePath}/*`,
        ]
      : []

  const useAudit = rawBinArgs.includes('--audit')
  const useDebug = isDebug('stdio')
  const useNodeOptions = nodeOptionsArg || permArgs.length
  const binArgs = rawBinArgs.filter(
    a => !isNpmAuditFlag(a) && !isNpmProgressFlag(a),
  )
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  // The default value of loglevel is "notice". We default to "error" which is
  // two levels quieter.
  const logLevelArgs = isSilent ? [FLAG_LOGLEVEL, 'error'] : []
  const noAuditArgs =
    useAudit || !(await findUp(NODE_MODULES, { cwd, onlyDirectories: true }))
      ? []
      : ['--no-audit']

  const stdio = ensureIpcInStdio(getOwn(spawnOpts, 'stdio'))

  const realBinPath = isShadowNpm
    ? await installNpmLinks(constants.shadowBinPath)
    : await installNpxLinks(constants.shadowBinPath)

  const spawnPromise = spawn(
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeDebugFlags,
      ...constants.nodeHardenFlags,
      ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
        : []),
      '--require',
      constants.shadowNpmInjectPath,
      realBinPath,
      ...noAuditArgs,
      ...(useNodeOptions
        ? [
            buildNpmNodeOptionsArg(
              process.env['NODE_OPTIONS'],
              nodeOptionsArg,
              permArgs,
            ),
          ]
        : []),
      '--no-fund',
      // Add '--no-progress' to fix input being swallowed by the npm spinner.
      '--no-progress',
      // Add '--loglevel=error' if a loglevel flag is not provided and the
      // SOCKET_CLI_DEBUG environment variable is not truthy.
      ...logLevelArgs,
      ...binArgs,
      ...otherArgs,
    ],
    {
      ...spawnOpts,
      env: {
        ...process.env,
        ...constants.processEnv,
        ...spawnEnv,
      },
      stdio,
    },
    extra,
  )

  spawnPromise.process.send({
    [constants.SOCKET_IPC_HANDSHAKE]: {
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]: getPublicApiToken(),
      [constants.SOCKET_CLI_SHADOW_BIN]: binName,
      [constants.SOCKET_CLI_SHADOW_PROGRESS]: progressArg,
      ...ipc,
    },
  })

  return { spawnPromise }
}
