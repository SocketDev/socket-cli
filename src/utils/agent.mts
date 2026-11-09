/** Run detected package manager install commands with Socket's safe defaults. */

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, { NPM, PNPM } from '../constants.mts'

import type { EnvDetails } from './package-environment.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

/** Run the detected package manager's install command with Socket's safe defaults. */
export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options: SpawnOptions & { args?: string[] | readonly string[] } = {},
): SpawnResult<string, SpawnExtra | undefined> {
  const { agent, agentExecPath, pkgPath } = pkgEnvDetails
  const { args = [], spinner, ...spawnOptions } = options
  const isNpm = agent === NPM
  const isPnpm = agent === PNPM
  const skipNodeHardenFlags = isPnpm && pkgEnvDetails.agentVersion.major < 11
  const installArgs = isNpm
    ? ['install', '--no-audit', '--no-fund', ...args]
    : isPnpm
      ? [
          'install',
          '--config.confirmModulesPurge=false',
          '--no-frozen-lockfile',
          ...args,
        ]
      : ['install', ...args]
  const nodeOptions = [
    process.env['NODE_OPTIONS'],
    ...(skipNodeHardenFlags ? [] : constants.nodeHardenFlags),
    ...constants.nodeNoWarningsFlags,
    '--disable-sigusr1',
  ]
    .filter(Boolean)
    .join(' ')
  return spawn(agentExecPath, installArgs, {
    cwd: pkgPath,
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      ...(isPnpm ? { CI: '1' } : {}),
      NODE_OPTIONS: nodeOptions,
      ...spawnOptions.env,
    },
  })
}
