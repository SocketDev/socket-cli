import { fileURLToPath } from 'node:url'

import {
  isNpmAuditFlag,
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
} from '@socketsecurity/registry/lib/agent'
import { isDebug } from '@socketsecurity/registry/lib/debug'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { ensureIpcInStdio } from './stdio-ipc.mts'
import constants, {
  FLAG_LOGLEVEL,
  NODE_MODULES,
  NPM,
  NPX,
} from '../constants.mts'
import { findUp } from '../utils/fs/fs.mjs'
import { cmdFlagsToString } from '../utils/process/cmd.mts'
import { installNpmLinks, installNpxLinks } from '../utils/shadow/links.mts'
import { getPublicApiToken } from '../utils/socket/sdk.mjs'

import type { IpcObject } from '../constants.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'
import type { StdioOptions } from 'node:child_process'

export type ShadowBinOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type ShadowBinResult = {
  spawnPromise: SpawnResult
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
    cwd = normalizePath(fileURLToPath(cwd))
  } else if (typeof cwd === 'string') {
    cwd = normalizePath(cwd)
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
  const useDebug = isDebug()
  const useNodeOptions = nodeOptionsArg || permArgs.length
  const binArgs = rawBinArgs.filter(
    a => !isNpmAuditFlag(a) && !isNpmProgressFlag(a),
  )
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  // The default value of loglevel is "notice". We default to "error" which is
  // two levels quieter.
  const logLevelArgs = isSilent ? [FLAG_LOGLEVEL, 'error'] : []
  const noAuditArgs =
    useAudit ||
    !(await findUp(NODE_MODULES, { cwd: cwd as string, onlyDirectories: true }))
      ? []
      : ['--no-audit']

  const stdio = ensureIpcInStdio(
    getOwn(spawnOpts, 'stdio') as StdioOptions | undefined,
  )

  const realBinPath = isShadowNpm
    ? await installNpmLinks(constants.shadowBinPath)
    : await installNpxLinks(constants.shadowBinPath)

  const spawnPromise = spawn(
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeDebugFlags,
      ...constants.nodeHardenFlags,
      // Memory flags commented out.
      // ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
        : []),
      '--require',
      constants.shadowNpmInjectPath,
      realBinPath,
      ...noAuditArgs,
      ...(useNodeOptions
        ? [
            `--node-options='${nodeOptionsArg ? nodeOptionsArg.slice(15) : ''}${cmdFlagsToString(permArgs)}'`,
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
