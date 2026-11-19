/** Run detected package manager install commands with Socket's safe defaults. */

import { spawn } from './spawn.mts'
import constants, { NPM, PNPM } from '../constants.mts'
import { isStandaloneSea } from '../sea/runtime.mts'
import { shadowNpmInstall } from '../shadow/npm/install.mts'

import type { EnvDetails } from './package-environment.mts'
import type { SpawnExtra, SpawnOptions, SpawnResult } from './spawn.mts'

const AUDIT_FLAGS = new Set(['--audit', '--no-audit'])
const FUND_FLAGS = new Set(['--fund', '--no-fund'])
const LOGLEVEL_FLAGS = new Set([
  '--loglevel',
  '-d',
  '--dd',
  '--ddd',
  '-q',
  '--quiet',
  '-s',
  '--silent',
])
const PROGRESS_FLAGS = new Set(['--progress', '--no-progress'])

export function isNpmAuditFlag(arg: string): boolean {
  return AUDIT_FLAGS.has(arg)
}

export function isNpmFundFlag(arg: string): boolean {
  return FUND_FLAGS.has(arg)
}

export function isNpmLoglevelFlag(arg: string): boolean {
  return arg.startsWith('--loglevel=') || LOGLEVEL_FLAGS.has(arg)
}

export function isNpmNodeOptionsFlag(arg: string): boolean {
  return arg.startsWith('--node-options=')
}

export function isNpmProgressFlag(arg: string): boolean {
  return PROGRESS_FLAGS.has(arg)
}

/** Run the detected package manager's install command with Socket's safe defaults. */
export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options: SpawnOptions & { args?: string[] | readonly string[] } = {},
): SpawnResult<string, SpawnExtra | undefined> {
  const { agent, agentExecPath, pkgPath } = pkgEnvDetails
  const { args = [], spinner, ...spawnOptions } = options
  const isNpm = agent === NPM
  if (isNpm && !isStandaloneSea()) {
    return shadowNpmInstall({
      agentExecPath,
      cwd: pkgPath,
      args,
      spinner,
      ...spawnOptions,
    })
  }
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
