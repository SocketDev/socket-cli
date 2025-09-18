import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants, {
  NPM,
  PNPM,
  YARN_BERRY,
  YARN_CLASSIC,
} from '../constants.mts'
import { cmdFlagsToString } from './cmd.mts'
import { shadowNpmInstall } from '../shadow/npm/install.mts'

import type { EnvDetails } from './package-environment.mts'

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

export type AgentInstallOptions = SpawnOption & {
  args?: string[] | readonly string[] | undefined
  spinner?: Spinner | undefined
}

export type AgentSpawnResult = ReturnType<typeof spawn>

export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options?: AgentInstallOptions | undefined,
): AgentSpawnResult {
  const { agent, agentExecPath, pkgPath } = pkgEnvDetails
  const isNpm = agent === NPM
  const isPnpm = agent === PNPM
  // All package managers support the "install" command.
  if (isNpm) {
    return shadowNpmInstall({
      agentExecPath,
      cwd: pkgPath,
      ...options,
    })
  }
  const {
    args = [],
    spinner,
    ...spawnOpts
  } = { __proto__: null, ...options } as AgentInstallOptions
  const skipNodeHardenFlags = isPnpm && pkgEnvDetails.agentVersion.major < 11
  // In CI mode, pnpm uses --frozen-lockfile by default, which prevents lockfile updates.
  // We need to explicitly disable it when updating the lockfile with overrides.
  const isCi = constants.ENV['CI']
  const installArgs =
    isPnpm && isCi
      ? ['install', '--no-frozen-lockfile', ...args]
      : ['install', ...args]

  // Debug logging for CI issues - always log in CI to diagnose Windows failures.
  if (isCi || process.env['CI']) {
    logger.error(`[DEBUG] runAgentInstall in CI mode:`)
    logger.error(`  platform: ${process.platform}`)
    logger.error(`  agent: ${agent}`)
    logger.error(`  isPnpm: ${isPnpm}`)
    logger.error(`  isCi: ${isCi}`)
    logger.error(`  constants.WIN32: ${constants.WIN32}`)
    logger.error(`  constants.ENV['CI']: ${constants.ENV['CI']}`)
    logger.error(`  process.env.CI: ${process.env['CI']}`)
    logger.error(`  installArgs: ${JSON.stringify(installArgs)}`)
    logger.error(`  agentExecPath: ${agentExecPath}`)
  }

  // On Windows with shell: true, if we get just the command name (not a full path),
  // we need to append .cmd for package managers to work correctly.
  let command = agentExecPath
  if (
    constants.WIN32 &&
    !agentExecPath.includes(path.sep) &&
    (agent === PNPM || agent === YARN_CLASSIC || agent === YARN_BERRY)
  ) {
    // If it's just a command name like 'pnpm' (no path separator), add .cmd for Windows.
    command = `${agentExecPath}.cmd`
  }

  return spawn(command, installArgs, {
    cwd: pkgPath,
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOpts,
    env: {
      ...process.env,
      ...constants.processEnv,
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags ? [] : constants.nodeHardenFlags),
        ...constants.nodeNoWarningsFlags,
      ]),
      ...getOwn(spawnOpts, 'env'),
    },
  })
}
