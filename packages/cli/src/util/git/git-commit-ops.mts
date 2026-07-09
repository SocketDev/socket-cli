/**
 * Commit-and-working-tree operations for Socket CLI's git utilities: staging,
 * committing, identity configuration, and hard resets.
 *
 * Extracted from operations.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { isDebug } from '@socketsecurity/lib-stable/debug/namespace'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOCKET_CLI_GIT_USER_EMAIL } from '../../env/socket-cli-git-user-email.mts'
import { SOCKET_CLI_GIT_USER_NAME } from '../../env/socket-cli-git-user-name.mts'
import { debugGit } from '../debug.mts'
import { getGitPath } from './git-path.mts'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['clean', '-fdx'], stdioIgnoreOptions)
    debugGit('clean -fdx', true)
    return true
  } catch (e) {
    debugGit('clean -fdx', false, { error: e })
  }
  return false
}

export async function gitCommit(
  commitMsg: string,
  filepaths: string[],
  options?: GitCreateAndPushBranchOptions | undefined,
): Promise<boolean> {
  if (!filepaths.length) {
    debug('miss: no filepaths to add')
    return false
  }
  const {
    cwd = process.cwd(),
    email = SOCKET_CLI_GIT_USER_EMAIL,
    user = SOCKET_CLI_GIT_USER_NAME,
  } = { __proto__: null, ...options } as GitCreateAndPushBranchOptions

  await gitEnsureIdentity(user || '', email || '', cwd)

  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['add', ...filepaths], stdioIgnoreOptions)
    debugGit('add', true, { count: filepaths.length })
  } catch (e) {
    debugGit('add', false, { error: e })
    debugDir({ filepaths })
    return false
  }

  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['commit', '-m', commitMsg], stdioIgnoreOptions)
    debugGit('commit', true)
    return true
  } catch (e) {
    debugGit('commit', false, { error: e })
    debugDir({ commitMsg })
  }
  return false
}

export async function gitEnsureIdentity(
  name: string,
  email: string,
  cwd = process.cwd(),
): Promise<void> {
  const stdioPipeOptions: SpawnOptions = { cwd }
  const identEntries: Array<[string, string]> = [
    ['user.email', email],
    ['user.name', name],
  ]
  await Promise.allSettled(
    identEntries.map(async ({ 0: prop, 1: value }) => {
      let configValue: string | Buffer | undefined
      try {
        // Will throw with exit code 1 if the config property is not set.
        const gitConfigResult = await spawn(
          'git',
          ['config', '--get', prop],
          stdioPipeOptions,
        )
        configValue = gitConfigResult.stdout
      } catch (e) {
        // Expected when config property is not set.
        debugDir({
          message: `Git config property not set: ${prop}`,
          error: e,
        })
      }
      if (configValue !== value) {
        const stdioIgnoreOptions: SpawnOptions = {
          cwd,
          stdio: isDebug() ? 'inherit' : 'ignore',
        }
        try {
          const gitBin = await getGitPath()
          await spawn(gitBin, ['config', prop, value], stdioIgnoreOptions)
        } catch (e) {
          debug(`Failed to set git config: ${prop}`)
          debugDir(e)
          debugDir({ value })
        }
      }
    }),
  )
}

export async function gitResetAndClean(
  branch = 'HEAD',
  cwd = process.cwd(),
): Promise<void> {
  // Discards tracked changes.
  await gitResetHard(branch, cwd)
  // Deletes all untracked files and directories.
  await gitCleanFdx(cwd)
}

export async function gitResetHard(
  branch = 'HEAD',
  cwd = process.cwd(),
): Promise<boolean> {
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug() ? 'inherit' : 'ignore',
  }
  try {
    const gitBin = await getGitPath()
    await spawn(gitBin, ['reset', '--hard', branch], stdioIgnoreOptions)
    debugGit(`reset --hard ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`reset --hard ${branch}`, false, { error: e })
  }
  return false
}
