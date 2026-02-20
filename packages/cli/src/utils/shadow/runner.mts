/** @fileoverview Shadow bin runner with IPC support and error handling. */

import { NPM, PNPM, YARN } from '../../constants/agents.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/packages.mts'
import { findUp } from '../fs/find-up.mts'

/**
 * Auto-detect package manager based on lockfiles.
 */
export async function detectPackageManager(
  cwd?: string | undefined,
): Promise<'npm' | 'pnpm' | 'yarn'> {
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, {
    cwd,
    onlyFiles: true,
  })
  const yarnLockPath = pnpmLockPath
    ? undefined
    : await findUp(YARN_LOCK, { cwd, onlyFiles: true })
  const npmLockPath =
    pnpmLockPath || yarnLockPath
      ? undefined
      : await findUp(PACKAGE_LOCK_JSON, { cwd, onlyFiles: true })

  if (pnpmLockPath) {
    return PNPM
  }
  if (yarnLockPath) {
    return YARN
  }
  if (npmLockPath) {
    return NPM
  }
  // Default to npm if no lockfile found.
  return NPM
}
