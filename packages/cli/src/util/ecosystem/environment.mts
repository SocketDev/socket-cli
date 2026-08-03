/**
 * Package environment detection utilities for Socket CLI. Analyzes project
 * environment and package manager configuration.
 *
 * Key Functions: - getPackageEnvironment: Detect package manager and project
 * details - makeConcurrentExecLimit: Calculate concurrent execution limits.
 *
 * Environment Detection: - Detects npm, pnpm, yarn, bun package managers -
 * Analyzes lockfiles for version information - Determines Node.js and engine
 * requirements - Identifies workspace configurations.
 *
 * Features: - Browser target detection via browserslist - Engine compatibility
 * checking - Package manager version detection - Workspace and monorepo
 * support.
 *
 * Usage: - Auto-detecting appropriate package manager - Validating environment
 * compatibility - Configuring concurrent execution limits.
 */

import type { Agent } from './supported-agents.mts'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'
import type { Remap } from '@socketsecurity/lib-stable/objects/types'
import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'
import type { SemVer } from 'semver'

export { AGENTS } from './supported-agents.mts'
export type { Agent } from './supported-agents.mts'

export {
  detectAndValidatePackageEnvironment,
  detectPackageEnvironment,
} from './environment-detect.mts'

export { getAgentExecPath, getAgentVersion } from './environment-agent.mts'

export type EnvBase = {
  agent: Agent
  agentExecPath: string
  agentSupported: boolean
  features: {
    // Fixed by https://github.com/npm/cli/pull/8089.
    // Landed in npm v11.2.0.
    npmBuggyOverrides: boolean
  }
  nodeSupported: boolean
  nodeVersion: SemVer
  npmExecPath: string
  pkgRequirements: {
    agent: string
    node: string
  }
  pkgSupports: {
    agent: boolean
    node: boolean
  }
}

export type EnvDetails = Readonly<
  Remap<
    EnvBase & {
      agentVersion: SemVer
      editablePkgJson: EditablePackageJson
      lockName: string
      lockPath: string
      lockSrc: string
      pkgPath: string
    }
  >
>

export type DetectAndValidateOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  prod?: boolean | undefined
}

export type DetectOptions = {
  cwd?: string | undefined
  onUnknown?: ((pkgManager: string | undefined) => void) | undefined
}

export type PartialEnvDetails = Readonly<
  Remap<
    EnvBase & {
      agentVersion: SemVer | undefined
      editablePkgJson: EditablePackageJson | undefined
      lockName: string | undefined
      lockPath: string | undefined
      lockSrc: string | undefined
      pkgPath: string | undefined
    }
  >
>

export type { ReadLockFile } from './lockfile-readers.mts'

export { preferWindowsCmdShim, resolveBinPathSync } from './windows-shims.mts'
