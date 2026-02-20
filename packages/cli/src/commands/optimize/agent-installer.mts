/**
 * Package manager agent installation utilities for optimize command.
 * Manages package installation via different package managers during optimization.
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
 * - Spinner support for progress indication
 * - CI-mode configuration for non-interactive execution
 */

import { NPM, PNPM } from '@socketsecurity/lib/constants/agents'
import {
  getNodeDisableSigusr1Flags,
  getNodeHardenFlags,
  getNodeNoWarningsFlags,
} from '@socketsecurity/lib/constants/node'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getOwn } from '@socketsecurity/lib/objects'
import { spawn } from '@socketsecurity/lib/spawn'

import { cmdFlagsToString } from '../../utils/process/cmd.mts'

import type { EnvDetails } from '../../utils/ecosystem/environment.mjs'
import type { Spinner } from '@socketsecurity/lib/spinner'

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

  const {
    args = [],
    spinner,
    ...spawnOpts
  } = { __proto__: null, ...options } as AgentInstallOptions

  // Skip harden flags for older pnpm versions.
  const skipNodeHardenFlags = isPnpm && pkgEnvDetails.agentVersion.major < 11

  // Configure package manager specific install arguments.
  let installArgs: string[]
  if (isNpm) {
    installArgs = [
      'install',
      // Avoid code paths for 'audit' and 'fund'.
      '--no-audit',
      '--no-fund',
      ...args,
    ]
  } else if (isPnpm) {
    installArgs = [
      'install',
      // Prevent interactive prompts in CI environments.
      '--config.confirmModulesPurge=false',
      // Allow lockfile updates (required for optimization).
      '--no-frozen-lockfile',
      ...args,
    ]
  } else {
    installArgs = ['install', ...args]
  }

  return spawn(agentExecPath, installArgs, {
    cwd: pkgPath,
    // Package managers on Windows often require shell execution.
    shell: WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOpts,
    env: {
      ...process.env,
      // Set CI mode for pnpm to ensure consistent behavior.
      ...(isPnpm ? { CI: '1' } : {}),
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags ? [] : getNodeHardenFlags()),
        ...getNodeNoWarningsFlags(),
        ...getNodeDisableSigusr1Flags(),
      ]),
      // @ts-expect-error - getOwn may return undefined, but spread handles it
      ...getOwn(spawnOpts, 'env'),
    },
  })
}
