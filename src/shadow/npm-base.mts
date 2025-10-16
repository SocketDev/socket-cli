import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getExecPath,
  getNodeDebugFlags,
  getNodeHardenFlags,
  getNodeNoWarningsFlags,
  supportsNodePermissionFlag,
} from '@socketsecurity/registry/constants/node'
import { NODE_MODULES } from '@socketsecurity/registry/constants/paths'
import {
  isNpmAuditFlag,
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
} from '@socketsecurity/registry/lib/agent'
import { isDebug } from '@socketsecurity/registry/lib/debug'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn, spawnSync } from '@socketsecurity/registry/lib/spawn'


import { ensureIpcInStdio } from './stdio-ipc.mts'
import { NPM, NPX } from '../constants/agents.mts'
import { FLAG_LOGLEVEL } from '../constants/cli.mts'
import ENV from '../constants/env.mts'
import {
  getInstrumentWithSentryPath,
  getShadowNpmInjectPath,
  shadowBinPath,
} from '../constants/paths.mts'
import {
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_IPC_HANDSHAKE,
} from '../constants/shadow.mts'
import { findUp } from '../utils/fs/fs.mjs'
import { cmdFlagsToString } from '../utils/process/cmd.mts'
import { installNpmLinks, installNpxLinks } from '../utils/shadow/links.mts'
import { getPublicApiToken } from '../utils/socket/sdk.mjs'

import type { IpcObject } from '../constants/shadow.mts'
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

  // Compute npm paths inline for permission flags.
  let npmGlobalPrefix = ''
  let npmCachePath = ''
  if (isShadowNpm && supportsNodePermissionFlag()) {
    try {
      const { findRealNpm } = await import('@socketsecurity/registry/lib/bin')
      const npmBin = findRealNpm()
      // Get npm global prefix.
      const prefixResult = spawnSync(npmBin, ['prefix', '-g'], {
        cwd: process.cwd(),
      })
      npmGlobalPrefix = prefixResult.stdout.toString().trim()
      // Get npm cache path.
      const cacheResult = spawnSync(npmBin, ['config', 'get', 'cache'], {
        cwd: process.cwd(),
      })
      npmCachePath = cacheResult.stdout.toString().trim()
    } catch {
      // Fallback to defaults if npm commands fail.
      const home = homedir()
      npmGlobalPrefix =
        process.platform === 'win32'
          ? path.join(
              process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming'),
              'npm',
            )
          : '/usr/local'
      npmCachePath = path.join(home, '.npm')
    }
  }

  const permArgs =
    isShadowNpm && supportsNodePermissionFlag()
      ? [
          '--permission',
          '--allow-child-process',
          // '--allow-addons',
          // '--allow-wasi',
          // Allow all reads because npm walks up directories looking for config
          // and package.json files.
          '--allow-fs-read=*',
          `--allow-fs-write=${cwd}/*`,
          `--allow-fs-write=${npmGlobalPrefix}/*`,
          `--allow-fs-write=${npmCachePath}/*`,
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
    ? await installNpmLinks(shadowBinPath)
    : await installNpxLinks(shadowBinPath)

  const spawnPromise = spawn(
    getExecPath(),
    [
      ...getNodeNoWarningsFlags(),
      ...getNodeDebugFlags(),
      ...getNodeHardenFlags(),
      // Memory flags commented out.
      // ...constants.nodeMemoryFlags,
      ...(ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', getInstrumentWithSentryPath()]
        : []),
      '--require',
      getShadowNpmInjectPath(),
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
        ...spawnEnv,
      },
      stdio,
    },
    extra,
  )

  spawnPromise.process.send({
    [SOCKET_IPC_HANDSHAKE]: {
      [SOCKET_CLI_SHADOW_API_TOKEN]: getPublicApiToken(),
      [SOCKET_CLI_SHADOW_BIN]: binName,
      [SOCKET_CLI_SHADOW_PROGRESS]: progressArg,
      ...ipc,
    },
  })

  return { spawnPromise }
}
