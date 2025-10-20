/**
 * Agent-specific constants and utilities.
 * Functions for package manager version requirements and execution paths.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { whichBin } from '@socketsecurity/lib/bin'
import {
  BUN,
  NPM,
  NPX,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/registry/constants/agents'

import type { Agent } from '../utils/ecosystem/environment.mjs'

// Re-export agent constants for backward compatibility.
export { BUN, NPM, NPX, PNPM, VLT, YARN, YARN_BERRY, YARN_CLASSIC }

/**
 * Minimum supported versions for each package manager agent.
 * These are the minimum versions required by Socket CLI.
 */
const MINIMUM_VERSIONS_BY_AGENT = {
  __proto__: null as any,
  // Bun >=1.1.39 supports the text-based lockfile.
  [BUN]: '1.1.39',
  // The npm version bundled with Node 18.
  [NPM]: '10.8.2',
  // 8.x is the earliest version to support Node 18.
  [PNPM]: '8.15.7',
  // 4.x supports >= Node 18.12.0
  [YARN_BERRY]: '4.0.0',
  // Latest 1.x.
  [YARN_CLASSIC]: '1.22.22',
  // vlt does not support overrides so we don't gate on it.
  [VLT]: '*',
}

/**
 * Get the minimum supported version for a package manager agent.
 *
 * @param agent - The package manager agent name
 * @returns The minimum version string (e.g., "10.8.2") or "*" for any version
 */
export function getMinimumVersionByAgent(agent: Agent): string {
  return MINIMUM_VERSIONS_BY_AGENT[agent] ?? '*'
}

/**
 * Get the execution path for npm.
 * Checks in order: node directory, PATH via whichBin.
 *
 * @returns The npm executable path
 */
export async function getNpmExecPath(): Promise<string> {
  // Check npm in the same directory as node.
  const nodeDir = path.dirname(process.execPath)
  const npmInNodeDir = path.join(nodeDir, NPM)
  if (existsSync(npmInNodeDir)) {
    return npmInNodeDir
  }
  // Fall back to whichBin.
  const whichResult = await whichBin(NPM, { nothrow: true })
  return (Array.isArray(whichResult) ? whichResult[0] : whichResult) ?? NPM
}

/**
 * Get the execution path for pnpm.
 * Uses whichBin to locate pnpm in PATH.
 *
 * @returns The pnpm executable path
 */
export async function getPnpmExecPath(): Promise<string> {
  const whichResult = await whichBin(PNPM, { nothrow: true })
  return (Array.isArray(whichResult) ? whichResult[0] : whichResult) ?? PNPM
}
