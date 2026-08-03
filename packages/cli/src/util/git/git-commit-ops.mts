/**
 * Commit-and-working-tree operations for Socket CLI's git utilities: staging,
 * committing, identity configuration, and hard resets.
 *
 * Extracted from operations.mts to keep that file under the 1000-line
 * File size hard cap.
 *
 * The commit here is the live trigger for a scanned repository's `pre-commit`
 * and `commit-msg` hooks, so every call goes through `spawnGit`, which forces
 * `core.hooksPath` empty.
 */

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'

import { SOCKET_CLI_GIT_USER_EMAIL } from '../../env/socket-cli-git-user-email.mts'
import { SOCKET_CLI_GIT_USER_NAME } from '../../env/socket-cli-git-user-name.mts'
import { debugGit } from '../debug.mts'
import { gitQuietStdio, spawnGit } from './spawn-git.mts'

export type GitCreateAndPushBranchOptions = {
  cwd?: string | undefined
  email?: string | undefined
  user?: string | undefined
}

export async function gitCleanFdx(cwd = process.cwd()): Promise<boolean> {
  try {
    await spawnGit(['clean', '-fdx'], { cwd, stdio: gitQuietStdio() })
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

  const stdio = gitQuietStdio()
  try {
    await spawnGit(['add'], { cwd, operands: filepaths, stdio })
    debugGit('add', true, { count: filepaths.length })
  } catch (e) {
    debugGit('add', false, { error: e })
    debugDir({ filepaths })
    return false
  }

  try {
    // `commitMsg` is CLI-authored and is consumed as the value of `-m`, so it
    // is never parsed as an option and needs no operand fence.
    await spawnGit(['commit', '-m', commitMsg], { cwd, stdio })
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
  const identEntries: Array<[string, string]> = [
    ['user.email', email],
    ['user.name', name],
  ]
  await Promise.allSettled(
    identEntries.map(async ({ 0: prop, 1: value }) => {
      let configValue: string | Buffer | undefined
      try {
        // Will throw with exit code 1 if the config property is not set.
        const gitConfigResult = await spawnGit(['config', '--get'], {
          cwd,
          operands: [prop],
        })
        configValue = gitConfigResult.stdout
      } catch (e) {
        // Expected when config property is not set.
        debugDir({
          message: `Git config property not set: ${prop}`,
          error: e,
        })
      }
      if (configValue !== value) {
        try {
          await spawnGit(['config'], {
            cwd,
            operands: [prop, value],
            stdio: gitQuietStdio(),
          })
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
  try {
    await spawnGit(['reset', '--hard'], {
      cwd,
      operands: [branch],
      stdio: gitQuietStdio(),
    })
    debugGit(`reset --hard ${branch}`, true)
    return true
  } catch (e) {
    debugGit(`reset --hard ${branch}`, false, { error: e })
  }
  return false
}
