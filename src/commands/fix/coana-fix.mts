import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getCiEnv, getOpenPrsForEnvironment } from './fix-env-helpers.mts'
import { getSocketBranchName, getSocketCommitMessage, gitCreateAndPushBranch, gitRemoteBranchExists, gitResetAndClean, gitUnstagedModifiedFiles } from './git.mts'
import { cleanupOpenPrs, enablePrAutoMerge, openPr, prExistForBranch, setGitRemoteGithubRepoUrl } from './open-pr.mts'
import { getAlertsMapOptions } from './shared.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../utils/alerts-map.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana.mts'
import { readLockfile } from '../../utils/lockfile.mts'
import { applyRange } from '../../utils/semver.mts'

import type { CResult } from '../../types.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import path from 'node:path'


type CoanaConfig = {
  autoMerge: boolean
  cwd: string
  extraArgs: string[]
  ghsas: string[]
  limit: number
  spinner: Spinner | undefined
  test: boolean
  testScript: string
}

export async function coanaFix(config: CoanaConfig): Promise<CResult<{ fixed: boolean }>> {
  const { cwd, limit, spinner } = config
  let { ghsas } = config

  spinner?.start()

  if (
    !ghsas.length ||
    (ghsas.length === 1 && ghsas[0] === 'auto')
  ) {
    const autoCResult = await spawnCoana(
      ['compute-fixes-and-upgrade-purls', cwd],
      { cwd, spinner },
    )
    if (!autoCResult.ok) {
      spinner?.stop()
      debugFn('coana fail:', {
        message: autoCResult.message,
        cause: autoCResult.cause,
      })
      return {}
    }

    ghsas = cmdFlagValueToArray(
      /(?<=Vulnerabilities found: )[^\n]+/.exec(
        autoCResult.data as string,
      )?.[0],
    )

    if (!ghsas.length) {
      spinner?.stop()
      return {}
    }

    spinner?.start()

    const ciEnv = await getCiEnv()

    if (!ciEnv) {
      const applyFixesCResult = await spawnCoana(
        [
          'compute-fixes-and-upgrade-purls',
          cwd,
          '--apply-fixes-to',
          ...ghsas,
          ...extraArgs,
        ],
        { cwd, spinner },
      )

      spinner?.stop()

      if (!applyFixesCResult.ok) {
        debugFn('coana fail:', {
          message: applyFixesCResult.message,
          cause: applyFixesCResult.cause,
        })
      }
      return {}
    }

  const openPrs = ciEnv ? await getOpenPrsForEnvironment(ciEnv) : []
  
 const handleInstallFail = (): CResult<{ fixed: boolean }> => {
    cleanupInfoEntriesLoop()
    return {
      ok: false,
      message: 'Install failed',
      cause: `Unexpected condition: ${pkgEnvDetails.agent} install failed`,
    }
  }

  for (const ghsa of ghsas) {
    let error
    let errored = false

    spinner?.start()

    const applyFixesCResult = await spawnCoana(
      [
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--apply-fixes-to',
        ghsa,
        ...extraArgs,
      ],
      { cwd, spinner },
    )

    spinner?.stop()

      // Check repoInfo to make TypeScript happy.
      if (applyFixesCResult.ok && ciEnv.repoInfo) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const unstagedCResult = await gitUnstagedModifiedFiles(cwd)
          if (!unstagedCResult.ok) {
            logger.warn(
              'Unexpected condition: Nothing to commit, skipping PR creation.',
            )
            continue
          }
          const moddedFilepaths = unstagedCResult.data
          if (!moddedFilepaths.length) {
            logger.warn(
              'Unexpected condition: Nothing to commit, skipping PR creation.',
            )
            continue infosLoop
          }

          const branch = getSocketBranchName(oldPurl, newVersion, workspace)
          let skipPr = false
          if (
            // eslint-disable-next-line no-await-in-loop
            await prExistForBranch(
              ciEnv.repoInfo.owner,
              ciEnv.repoInfo.repo,
              branch,
            )
          ) {
            skipPr = true
            debugFn(`skip: branch "${branch}" exists`)
          }
          // eslint-disable-next-line no-await-in-loop
          else if (await gitRemoteBranchExists(branch, cwd)) {
            skipPr = true
            debugFn(`skip: remote branch "${branch}" exists`)
          } else if (
            // eslint-disable-next-line no-await-in-loop
            !(await gitCreateAndPushBranch(
              branch,
              getSocketCommitMessage(oldPurl, newVersion, workspace),
              moddedFilepaths,
              {
                cwd,
                email: ciEnv.gitEmail,
                user: ciEnv.gitUser,
              },
            ))
          ) {
            skipPr = true
            logger.warn(
              'Unexpected condition: Push failed, skipping PR creation.',
            )
          }
          if (skipPr) {
            // eslint-disable-next-line no-await-in-loop
            await gitResetAndClean(ciEnv.baseBranch, cwd)

            // Exit early if install fails.
            return handleInstallFail()
          }

          // eslint-disable-next-line no-await-in-loop
          await Promise.allSettled([
            setGitRemoteGithubRepoUrl(
              ciEnv.repoInfo.owner,
              ciEnv.repoInfo.repo,
              ciEnv.githubToken!,
              cwd,
            ),
            cleanupOpenPrs(ciEnv.repoInfo.owner, ciEnv.repoInfo.repo, {
              newVersion,
              purl: oldPurl,
              workspace,
            }),
          ])
          // eslint-disable-next-line no-await-in-loop
          const prResponse = await openPr(
            ciEnv.repoInfo.owner,
            ciEnv.repoInfo.repo,
            branch,
            oldPurl,
            newVersion,
            {
              baseBranch: ciEnv.baseBranch,
              cwd,
              workspace,
            },
          )
          if (prResponse) {
            const { data } = prResponse
            const prRef = `PR #${data.number}`
            logger.success(`Opened ${prRef}.`)
            if (autoMerge) {
              logger.indent()
              spinner?.indent()
              // eslint-disable-next-line no-await-in-loop
              const { details, enabled } = await enablePrAutoMerge(data)
              if (enabled) {
                logger.info(`Auto-merge enabled for ${prRef}.`)
              } else {
                const message = `Failed to enable auto-merge for ${prRef}${
                  details
                    ? `:\n${details.map(d => ` - ${d}`).join('\n')}`
                    : '.'
                }`
                logger.error(message)
              }
              logger.dedent()
              spinner?.dedent()
            }
          }
        } catch (e) {
          error = e
          errored = true
        }
      }

      spinner?.start()

      // eslint-disable-next-line no-await-in-loop
      await gitResetAndClean(ciEnv.baseBranch, cwd)

      spinner?.stop()

      if (errored) {
        return {
          ok: false,
          message: 'Update failed',
          cause: `Update failed for ${oldId} in ${workspace}${error ? '; ' + error : ''}`,
        }
      }
      debugFn('name:', name)
      debugFn('increment: count', count + 1)
      if (++count >= limit) {
        cleanupInfoEntriesLoop()
        break
      }
    }
  }
}
