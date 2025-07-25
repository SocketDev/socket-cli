import { existsSync } from 'node:fs'
import path from 'node:path'

import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runNpmScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson,
  resolvePackageName,
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { getPrsForPurl } from './fix-branch-helpers.mts'
import { getFixEnv } from './fix-env-helpers.mts'
import { getActualTree } from './get-actual-tree.mts'
import {
  cleanupPrs,
  enablePrAutoMerge,
  openPr,
  setGitRemoteGithubRepoUrl,
} from './pull-request.mts'
import { getSocketBranchName, getSocketCommitMessage } from './socket-git.mts'
import constants from '../../constants.mts'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode,
} from '../../shadow/npm/arborist-helpers.mts'
import { removeNodeModules } from '../../utils/fs.mts'
import {
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from '../../utils/git.mts'
import { globWorkspace } from '../../utils/glob.mts'
import { getPurlObject } from '../../utils/purl.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'
import { getOverridesData } from '../optimize/get-overrides-by-agent.mts'

import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { AlertsByPurl } from '../../utils/socket-package-alert.mts'
import type {
  EditablePackageJson,
  Packument,
} from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  autoMerge: boolean
  cwd: string
  ghsas: string[]
  limit: number
  minSatisfying: boolean
  orgSlug: string
  prCheck: boolean
  purls: string[]
  rangeStyle: RangeStyle
  spinner: Spinner | undefined
  test: boolean
  testScript: string
  unknownFlags: string[]
}

export type InstallOptions = {
  args?: string[] | undefined
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

export type InstallPhaseHandler = (
  editablePkgJson: EditablePackageJson,
  packument: Packument,
  oldVersion: string,
  newVersion: string,
  vulnerableVersionRange: string,
  fixConfig: FixConfig,
) => Promise<void>

export type Installer = (
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
) => Promise<NodeClass | null>

const noopHandler = (() => {}) as unknown as InstallPhaseHandler

export async function agentFix(
  pkgEnvDetails: EnvDetails,
  actualTree: NodeClass | undefined,
  alertsMap: AlertsByPurl,
  installer: Installer,
  {
    afterInstall = noopHandler,
    afterUpdate = noopHandler,
    beforeInstall = noopHandler,
    revertInstall = noopHandler,
  }: {
    beforeInstall?: InstallPhaseHandler | undefined
    afterUpdate?: InstallPhaseHandler | undefined
    afterInstall?: InstallPhaseHandler | undefined
    revertInstall?: InstallPhaseHandler | undefined
  },
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { pkgPath: rootPath } = pkgEnvDetails

  const fixEnv = await getFixEnv()
  debugDir('inspect', { fixEnv })

  const {
    autoMerge,
    cwd,
    limit,
    minSatisfying,
    prCheck,
    rangeStyle,
    spinner,
    test,
    testScript,
  } = fixConfig

  let count = 0

  const infoByPartialPurl = getCveInfoFromAlertsMap(alertsMap, {
    exclude: { upgradable: true },
  })
  if (!infoByPartialPurl) {
    spinner?.stop()
    logger.info('No fixable vulns found.')
    if (alertsMap.size) {
      debugDir('inspect', { alertsMap })
    } else {
      debugFn('inspect', '{ alertsMap: Map(0) {} }')
    }
    return { ok: true, data: { fixed: false } }
  }

  if (isDebug('notice,inspect')) {
    spinner?.stop()
    const partialPurls = Array.from(infoByPartialPurl.keys())
    const { length: purlsCount } = partialPurls
    debugFn(
      'notice',
      `found: ${purlsCount} ${pluralize('PURL', purlsCount)} with CVEs`,
    )
    debugDir('inspect', { partialPurls })
    spinner?.start()
  }

  // Lazily access constants.packumentCache.
  const { packumentCache } = constants

  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath,
  )
  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!,
  ]
  const sortedInfoEntries = Array.from(infoByPartialPurl.entries()).sort(
    (a, b) => naturalCompare(a[0], b[0]),
  )

  const cleanupInfoEntriesLoop = () => {
    logger.dedent()
    spinner?.dedent()
    packumentCache.clear()
  }

  const getModifiedFiles = async (cwd = process.cwd()) => {
    const unstagedCResult = await gitUnstagedModifiedFiles(cwd)
    return unstagedCResult.ok
      ? unstagedCResult.data.filter(filepath => {
          const basename = path.basename(filepath)
          return (
            basename === 'package.json' || basename === pkgEnvDetails.lockName
          )
        })
      : []
  }

  const handleInstallFail = (): CResult<{ fixed: boolean }> => {
    cleanupInfoEntriesLoop()
    spinner?.stop()
    return {
      ok: false,
      message: 'Install failed',
      cause: `Unexpected condition: ${pkgEnvDetails.agent} install failed`,
    }
  }

  const hasModifiedFiles = async (cwd = process.cwd()) => {
    return (await getModifiedFiles(cwd)).length > 0
  }

  spinner?.stop()

  infoEntriesLoop: for (
    let i = 0, { length } = sortedInfoEntries;
    i < length;
    i += 1
  ) {
    const isLastInfoEntry = i === length - 1
    const infoEntry = sortedInfoEntries[i]!
    const partialPurlObj = getPurlObject(infoEntry[0])
    const name = resolvePackageName(partialPurlObj)

    const infos = Array.from(infoEntry[1].values())
    if (!infos.length) {
      debugFn('notice', `miss: CVEs expected, but not found, for ${name}`)
      continue infoEntriesLoop
    }

    logger.log(`Processing '${name}'`)
    logger.indent()
    spinner?.indent()

    if (getManifestData(partialPurlObj.type, name)) {
      debugFn('notice', `found: Socket Optimize variant for ${name}`)
    }
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    if (!packument) {
      logger.warn(`Unexpected condition: No packument found for ${name}.\n`)
      cleanupInfoEntriesLoop()
      // Skip to next package.
      continue infoEntriesLoop
    }

    debugDir('inspect', { infos })

    const availableVersions = Object.keys(packument.versions)
    const prs = getPrsForPurl(fixEnv, infoEntry[0])
    const warningsForAfter = new Set<string>()

    let changed = false
    // eslint-disable-next-line no-unused-labels
    pkgJsonPathsLoop: for (
      let j = 0, { length: length_j } = pkgJsonPaths;
      j < length_j;
      j += 1
    ) {
      const isLastPkgJsonPath = j === length_j - 1
      const pkgJsonPath = pkgJsonPaths[j]!
      const pkgPath = path.dirname(pkgJsonPath)
      const isWorkspaceRoot =
        pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
      const workspace = isWorkspaceRoot
        ? 'root'
        : path.relative(rootPath, pkgPath)
      // actualTree may not be defined on the first iteration of pkgJsonPathsLoop.
      if (!actualTree) {
        if (!fixEnv.isCi) {
          // eslint-disable-next-line no-await-in-loop
          await removeNodeModules(cwd)
        }
        const maybeActualTree =
          fixEnv.isCi && existsSync(path.join(rootPath, 'node_modules'))
            ? // eslint-disable-next-line no-await-in-loop
              await getActualTree(cwd)
            : // eslint-disable-next-line no-await-in-loop
              await installer(pkgEnvDetails, { cwd, spinner })
        if (maybeActualTree && existsSync(pkgEnvDetails.lockPath)) {
          actualTree = maybeActualTree
        }
      }
      if (!actualTree) {
        // Exit early if install fails.
        return handleInstallFail()
      }

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.version)
          .filter(Boolean),
      )

      if (!oldVersions.length) {
        debugFn('notice', `skip: ${name} not found`)
        cleanupInfoEntriesLoop()
        // Skip to next package.
        continue infoEntriesLoop
      }

      // Always re-read the editable package.json to avoid stale mutations
      // across iterations.
      // eslint-disable-next-line no-await-in-loop
      const editablePkgJson = await readPackageJson(pkgJsonPath, {
        editable: true,
      })

      const seenBranches = new Set<string>()
      const seenVersions = new Set<string>()

      let hasAnnouncedWorkspace = false
      let workspaceLogCallCount = logger.logCallCount
      if (isDebug('notice')) {
        debugFn('notice', `check: workspace ${workspace}`)
        hasAnnouncedWorkspace = true
        workspaceLogCallCount = logger.logCallCount
      }

      oldVersionsLoop: for (const oldVersion of oldVersions) {
        const oldId = `${name}@${oldVersion}`
        const oldPurl = idToPurl(oldId, partialPurlObj.type)

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          debugFn('notice', `skip: ${oldId} not found`)
          continue oldVersionsLoop
        }
        infosLoop: for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange,
        } of infos) {
          const newVersion = findBestPatchVersion(node, availableVersions, {
            minSatisfying,
            vulnerableVersionRange,
          })
          const newVersionPackument = newVersion
            ? packument.versions[newVersion]
            : undefined

          if (!(newVersion && newVersionPackument)) {
            warningsForAfter.add(
              `${oldId} not updated: requires >=${firstPatchedVersionIdentifier}`,
            )
            continue infosLoop
          }
          if (seenVersions.has(newVersion)) {
            continue infosLoop
          }
          if (semver.gte(oldVersion, newVersion)) {
            debugFn('silly', `skip: ${oldId} is >= ${newVersion}`)
            continue infosLoop
          }
          const branch = getSocketBranchName(oldPurl, newVersion, workspace)
          if (seenBranches.has(branch)) {
            continue infosLoop
          }
          const pr = prCheck
            ? prs.find(p => p.headRefName === branch)
            : undefined
          if (pr) {
            debugFn(
              'notice',
              `skip: PR #${pr.number} for ${name}@${newVersion} exists`,
            )
            seenBranches.add(branch)
            continue infosLoop
          }
          if (
            fixEnv.isCi &&
            // eslint-disable-next-line no-await-in-loop
            (await gitRemoteBranchExists(branch, cwd))
          ) {
            debugFn(
              'notice',
              `skip: remote branch "${branch}" for ${name}@${newVersion} exists`,
            )
            seenBranches.add(branch)
            continue infosLoop
          }
          const { overrides: oldOverrides } = getOverridesData(
            pkgEnvDetails,
            editablePkgJson.content,
          )
          let refRange = oldOverrides?.[`${name}@${vulnerableVersionRange}`]
          if (!isNonEmptyString(refRange)) {
            refRange = oldOverrides?.[name]
          }
          if (!isNonEmptyString(refRange)) {
            refRange = oldVersion
          }

          // eslint-disable-next-line no-await-in-loop
          await beforeInstall(
            editablePkgJson,
            packument,
            oldVersion,
            newVersion,
            vulnerableVersionRange,
            fixConfig,
          )

          updatePackageJsonFromNode(
            editablePkgJson,
            actualTree,
            node,
            newVersion,
            rangeStyle,
          )

          // eslint-disable-next-line no-await-in-loop
          await editablePkgJson.save({ ignoreWhitespace: true })

          // eslint-disable-next-line no-await-in-loop
          await afterUpdate(
            editablePkgJson,
            packument,
            oldVersion,
            newVersion,
            vulnerableVersionRange,
            fixConfig,
          )

          // eslint-disable-next-line no-await-in-loop
          if (!(await hasModifiedFiles(cwd))) {
            debugFn('notice', `skip: no changes for ${name}@${newVersion}`)
            seenVersions.add(newVersion)
            // Reset things just in case.
            if (fixEnv.isCi) {
              // eslint-disable-next-line no-await-in-loop
              await gitResetAndClean(fixEnv.baseBranch, cwd)
              // eslint-disable-next-line no-await-in-loop
              await gitCheckoutBranch(fixEnv.baseBranch, cwd)
            }
            continue infosLoop
          }

          spinner?.start()

          if (!hasAnnouncedWorkspace) {
            hasAnnouncedWorkspace = true
            workspaceLogCallCount = logger.logCallCount
          }

          const newId = `${name}@${applyRange(refRange, newVersion, rangeStyle)}`
          spinner?.info(`Installing ${newId} in ${workspace}.`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await installer(pkgEnvDetails, {
              cwd,
              spinner,
            })
            if (maybeActualTree && existsSync(pkgEnvDetails.lockPath)) {
              actualTree = maybeActualTree
              // eslint-disable-next-line no-await-in-loop
              await afterInstall(
                editablePkgJson,
                packument,
                oldVersion,
                newVersion,
                vulnerableVersionRange,
                fixConfig,
              )
              if (test) {
                spinner?.info(`Testing ${newId} in ${workspace}.`)
                // eslint-disable-next-line no-await-in-loop
                await runNpmScript(testScript, [], { spinner, stdio: 'ignore' })
              }
              spinner?.success(`Fixed ${name} in ${workspace}.`)
              seenVersions.add(newVersion)
            } else {
              errored = true
            }
          } catch (e) {
            error = e
            errored = true
          }

          spinner?.stop()

          // Check repoInfo to make TypeScript happy.
          if (!errored && fixEnv.isCi && fixEnv.repoInfo) {
            debugFn('notice', 'pr: creating')
            try {
              const pushed =
                // eslint-disable-next-line no-await-in-loop
                (await gitCreateBranch(branch, cwd)) &&
                // eslint-disable-next-line no-await-in-loop
                (await gitCheckoutBranch(branch, cwd)) &&
                // eslint-disable-next-line no-await-in-loop
                (await gitCommit(
                  getSocketCommitMessage(oldPurl, newVersion, workspace),
                  // eslint-disable-next-line no-await-in-loop
                  await getModifiedFiles(cwd),
                  {
                    cwd,
                    email: fixEnv.gitEmail,
                    user: fixEnv.gitUser,
                  },
                )) &&
                // eslint-disable-next-line no-await-in-loop
                (await gitPushBranch(branch, cwd))
              if (!pushed) {
                logger.warn(
                  'Unexpected condition: Push failed, skipping PR creation.',
                )
                // eslint-disable-next-line no-await-in-loop
                await gitResetAndClean(fixEnv.baseBranch, cwd)
                // eslint-disable-next-line no-await-in-loop
                await gitCheckoutBranch(fixEnv.baseBranch, cwd)
                // eslint-disable-next-line no-await-in-loop
                await gitDeleteBranch(branch, cwd)
                // eslint-disable-next-line no-await-in-loop
                const maybeActualTree = await installer(pkgEnvDetails, {
                  cwd,
                  spinner,
                })
                if (maybeActualTree && existsSync(pkgEnvDetails.lockPath)) {
                  actualTree = maybeActualTree
                  continue infosLoop
                }
                // Exit early if install fails.
                return handleInstallFail()
              }

              seenBranches.add(branch)

              // eslint-disable-next-line no-await-in-loop
              await Promise.allSettled([
                setGitRemoteGithubRepoUrl(
                  fixEnv.repoInfo.owner,
                  fixEnv.repoInfo.repo,
                  fixEnv.githubToken!,
                  cwd,
                ),
                cleanupPrs(fixEnv.repoInfo.owner, fixEnv.repoInfo.repo, {
                  newVersion,
                  purl: oldPurl,
                  workspace,
                }),
              ])
              // eslint-disable-next-line no-await-in-loop
              const prResponse = await openPr(
                fixEnv.repoInfo.owner,
                fixEnv.repoInfo.repo,
                branch,
                oldPurl,
                newVersion,
                {
                  baseBranch: fixEnv.baseBranch,
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
          } else if (fixEnv.isCi) {
            debugFn('notice', 'skip: PR creation')
          }

          if (fixEnv.isCi) {
            spinner?.start()
            // eslint-disable-next-line no-await-in-loop
            await gitResetAndClean(branch, cwd)
            // eslint-disable-next-line no-await-in-loop
            await gitCheckoutBranch(fixEnv.baseBranch, cwd)
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await installer(pkgEnvDetails, {
              cwd,
              spinner,
            })
            spinner?.stop()
            if (maybeActualTree) {
              actualTree = maybeActualTree
            } else {
              errored = true
            }
          }
          if (errored) {
            if (!fixEnv.isCi) {
              spinner?.start()
              // eslint-disable-next-line no-await-in-loop
              await revertInstall(
                editablePkgJson,
                packument,
                oldVersion,
                newVersion,
                vulnerableVersionRange,
                fixConfig,
              )
              // eslint-disable-next-line no-await-in-loop
              await Promise.all([
                removeNodeModules(cwd),
                editablePkgJson.save({ ignoreWhitespace: true }),
              ])
              // eslint-disable-next-line no-await-in-loop
              const maybeActualTree = await installer(pkgEnvDetails, {
                cwd,
                spinner,
              })
              spinner?.stop()
              if (maybeActualTree) {
                actualTree = maybeActualTree
              } else {
                // Exit early if install fails.
                return handleInstallFail()
              }
            }
            return {
              ok: false,
              message: 'Update failed',
              cause: `Update failed for ${oldId} in ${workspace}${error ? '; ' + error : ''}`,
            }
          } else {
            changed = true
          }
          debugFn('notice', 'increment: count', count + 1)
          if (++count >= limit) {
            cleanupInfoEntriesLoop()
            // Exit main loop.
            break infoEntriesLoop
          }
        }
      }
      if (!isLastPkgJsonPath && logger.logCallCount > workspaceLogCallCount) {
        logger.logNewline()
      }
    }

    for (const warningText of warningsForAfter) {
      logger.warn(warningText)
    }
    if (!changed && !warningsForAfter.size) {
      logger.info('No vulnerable versions found.')
    }
    if (!isLastInfoEntry) {
      logger.logNewline()
    }
    cleanupInfoEntriesLoop()
  }

  spinner?.stop()

  // Or, did we change anything?
  return { ok: true, data: { fixed: true } }
}
