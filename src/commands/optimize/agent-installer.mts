/**
 * Package manager agent installation utilities for optimize command.
 * Manages package installation via different package managers during optimization.
 *
 * Key Functions:
 * - runAgentInstall: Execute package installation with detected agent
 *
 * Supported Agents:
 * - npm: Node Package Manager with shadow installation
 * - pnpm: Fast, disk space efficient package manager
 * - yarn: Alternative package manager
 *
 * Features:
 * - Automatic agent detection
 * - Shadow installation for security scanning
 * - Spinner support for progress indication
 * - CI-mode configuration for non-interactive execution
 */

import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants, { NPM, PNPM } from '../../constants.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'
import { shadowNpmInstall } from '../../shadow/npm/install.mts'

import type { EnvDetails } from '../../utils/package-environment.mts'

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

export interface AgentInstallOptions extends SpawnOption {
  args?: string[] | readonly string[] | undefined
  spinner?: Spinner | undefined
}

export type AgentSpawnResult = ReturnType<typeof spawn>

/**
 * Execute package installation with the detected package manager agent.
 * Handles different package managers with appropriate configuration for optimization.
 */
export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options?: AgentInstallOptions | undefined,
): AgentSpawnResult {
  const { agent, agentExecPath, pkgPath } = pkgEnvDetails
  const isNpm = agent === NPM
  const isPnpm = agent === PNPM

  // Use shadow installation for npm to enable security scanning.
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

  // Configure package manager specific install arguments.
  const installArgs = isPnpm
    ? [
        'install',
        // Prevent interactive prompts in CI environments.
        '--config.confirmModulesPurge=false',
        // Allow lockfile updates (required for optimization).
        '--no-frozen-lockfile',
        ...args,
      ]
    : ['install', ...args]

  return spawn(agentExecPath, installArgs, {
    cwd: pkgPath,
    // Package managers on Windows often require shell execution.
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOpts,
    env: {
      ...process.env,
      ...constants.processEnv,
      // Set CI mode for pnpm to ensure consistent behavior.
      ...(isPnpm ? { CI: '1' } : {}),
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags ? [] : constants.nodeHardenFlags),
        ...constants.nodeNoWarningsFlags,
      ]),
      ...getOwn(spawnOpts, 'env'),
    },
  })
}
