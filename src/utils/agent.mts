/**
 * Package manager agent utilities for Socket CLI.
 * Manages package installation via different package managers.
 *
 * Key Functions:
 * - runAgentInstall: Execute package installation with detected agent
 *
 * Supported Agents:
 * - npm: Node Package Manager
 * - pnpm: Fast, disk space efficient package manager
 * - yarn: Alternative package manager
 *
 * Features:
 * - Automatic agent detection
 * - Shadow installation for security scanning
 * - Spinner support for progress indication
 */

import { cmdFlagsToString } from './cmd.mts'
import { getOwn } from './objects.mts'
import { spawn } from './spawn.mts'
import { Spinner } from './spinner.mts'
import constants, { NPM, PNPM } from '../constants.mts'
import { shadowNpmInstall } from '../shadow/npm/install.mts'

import type { EnvDetails } from './package-environment.mts'

const auditFlags = new Set(['--audit', '--no-audit'])
const fundFlags = new Set(['--fund', '--no-fund'])
const logFlags = new Set([
  '--loglevel',
  '-d',
  '--dd',
  '--ddd',
  '-q',
  '--quiet',
  '-s',
  '--silent',
])
const progressFlags = new Set(['--progress', '--no-progress'])

export const isNpmAuditFlag = (arg: string): boolean => auditFlags.has(arg)
export const isNpmFundFlag = (arg: string): boolean => fundFlags.has(arg)
export const isNpmLoglevelFlag = (arg: string): boolean =>
  arg.startsWith('--loglevel=') || logFlags.has(arg)
export const isNpmNodeOptionsFlag = (arg: string): boolean =>
  arg.startsWith('--node-options=')
export const isNpmProgressFlag = (arg: string): boolean =>
  progressFlags.has(arg)

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
  // Also add --config.confirmModulesPurge=false to avoid interactive prompts.
  const installArgs = isPnpm
    ? [
        'install',
        '--config.confirmModulesPurge=false',
        '--no-frozen-lockfile',
        ...args,
      ]
    : ['install', ...args]

  return spawn(agentExecPath, installArgs, {
    cwd: pkgPath,
    // On Windows, package managers are often .cmd files that require shell execution.
    // The spawn function from @socketsecurity/registry will handle this properly
    // when shell is true.
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOpts,
    env: {
      ...process.env,
      ...constants.processEnv,
      // Set CI for pnpm to ensure non-interactive mode and consistent behavior.
      ...(isPnpm ? { CI: '1' } : {}),
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags ? [] : constants.nodeHardenFlags),
        ...constants.nodeNoWarningsFlags,
      ]),
      ...getOwn(spawnOpts, 'env'),
    },
  })
}
