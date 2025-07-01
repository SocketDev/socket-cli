import { existsSync } from 'node:fs'
import path from 'node:path'

import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runNpmScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson,
  resolvePackageName,
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { getActiveBranchesForPackage } from './fix-branch-helpers.mts'
import { getActualTree } from './get-actual-tree.mts'
import {
  getSocketBranchName,
  getSocketBranchWorkspaceComponent,
  getSocketCommitMessage,
  gitCreateAndPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from './git.mts'
import {
  cleanupOpenPrs,
  enablePrAutoMerge,
  openPr,
  prExistForBranch,
  setGitRemoteGithubRepoUrl,
} from './open-pr.mts'
import constants from '../../constants.mts'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode,
} from '../../shadow/npm/arborist-helpers.mts'
import { removeNodeModules } from '../../utils/fs.mts'
import { globWorkspace } from '../../utils/glob.mts'
import { readLockfile } from '../../utils/lockfile.mts'
import { getPurlObject } from '../../utils/purl.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'
import { getOverridesData } from '../optimize/get-overrides-by-agent.mts'

import type { CiEnv } from './fix-env-helpers.mts'
import type { PrMatch } from './open-pr.mts'
import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { AlertsByPurl } from '../../utils/socket-package-alert.mts'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type FixConfig = {
  autoMerge: boolean
  cwd: string
  limit: number
  purls: string[]
  rangeStyle: RangeStyle
  spinner: Spinner | undefined
  test: boolean
  testScript: string
}

export type InstallOptions = {
  args?: string[] | undefined
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

export type InstallPhaseHandler = (
  editablePkgJson: EditablePackageJson,
  name: string,
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
    beforeInstall = noopHandler,
    // eslint-disable-next-line sort-destructure-keys/sort-destructure-keys
    afterInstall = noopHandler,
    revertInstall = noopHandler,
  }: {
    beforeInstall?: InstallPhaseHandler | undefined
    afterInstall?: InstallPhaseHandler | undefined
    revertInstall?: InstallPhaseHandler | undefined
  },
  ciEnv: CiEnv | null,
  openPrs: PrMatch[],
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { pkgPath: rootPath } = pkgEnvDetails
  const { autoMerge, cwd, limit, rangeStyle, spinner, test, testScript } =
    fixConfig

  let count = 0

  const infoByPartialPurl = getCveInfoFromAlertsMap(alertsMap, {
    limit: Math.max(limit, openPrs.length),
  })
  if (!infoByPartialPurl) {
    spinner?.stop()
    logger.info('No fixable vulns found.')
    if (alertsMap.size) {
      debugFn('inspect:', { alertsMap })
    } else {
      debugFn('inspect: { alertsMap: Map(0) {} }')
    }
    return { ok: true, data: { fixed: false } }
  }

  if (isDebug()) {
    debugFn('found: cves for', Array.from(infoByPartialPurl.keys()))
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

  const handleInstallFail = (): CResult<{ fixed: boolean }> => {
    cleanupInfoEntriesLoop()
    return {
      ok: false,
      message: 'Install failed',
      cause: `Unexpected condition: ${pkgEnvDetails.agent} install failed`,
    }
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
      continue infoEntriesLoop
    }

    logger.log(`Processing vulns for ${name}:`)
    logger.indent()
    spinner?.indent()

    if (getManifestData(partialPurlObj.type, name)) {
      debugFn(`found: Socket Optimize variant for ${name}`)
    }
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    if (!packument) {
      logger.warn(`Unexpected condition: No packument found for ${name}.\n`)
      cleanupInfoEntriesLoop()
      continue infoEntriesLoop
    }

    const activeBranches = getActiveBranchesForPackage(
      ciEnv,
      infoEntry[0],
      openPrs,
    )
    const availableVersions = Object.keys(packument.versions)
    const warningsForAfter = new Set<string>()

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
      const branchWorkspace = ciEnv
        ? getSocketBranchWorkspaceComponent(workspace)
        : ''

      // actualTree may not be defined on the first iteration of pkgJsonPathsLoop.
      if (!actualTree) {
        if (!ciEnv) {
          // eslint-disable-next-line no-await-in-loop
          await removeNodeModules(cwd)
        }
        const maybeActualTree =
          ciEnv && existsSync(path.join(rootPath, 'node_modules'))
            ? // eslint-disable-next-line no-await-in-loop
              await getActualTree(cwd)
            : // eslint-disable-next-line no-await-in-loop
              await installer(pkgEnvDetails, { cwd, spinner })
        const maybeLockSrc = maybeActualTree
          ? // eslint-disable-next-line no-await-in-loop
            await readLockfile(pkgEnvDetails.lockPath)
          : null
        if (maybeActualTree && maybeLockSrc) {
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
        debugFn(`skip: ${name} not found\n`)
        // Skip to next package.
        cleanupInfoEntriesLoop()
        continue infoEntriesLoop
      }

      // Always re-read the editable package.json to avoid stale mutations
      // across iterations.
      // eslint-disable-next-line no-await-in-loop
      const editablePkgJson = await readPackageJson(pkgJsonPath, {
        editable: true,
      })
      const seenVersions = new Set<string>()

      let hasAnnouncedWorkspace = false
      let workspaceLogCallCount = logger.logCallCount
      if (isDebug()) {
        debugFn(`check: workspace ${workspace}`)
        hasAnnouncedWorkspace = true
        workspaceLogCallCount = logger.logCallCount
      }

      oldVersionsLoop: for (const oldVersion of oldVersions) {
        const oldId = `${name}@${oldVersion}`
        const oldPurl = idToPurl(oldId, partialPurlObj.type)

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          debugFn(`skip: ${oldId} not found`)
          continue oldVersionsLoop
        }
        infosLoop: for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange,
        } of infos) {
          const newVersion = findBestPatchVersion(
            node,
            availableVersions,
            vulnerableVersionRange,
          )
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
            debugFn(`skip: ${oldId} is >= ${newVersion}`)
            continue infosLoop
          }
          if (
            activeBranches.find(
              b =>
                b.workspace === branchWorkspace && b.newVersion === newVersion,
            )
          ) {
            debugFn(`skip: open PR found for ${name}@${newVersion}`)
            if (++count >= limit) {
              cleanupInfoEntriesLoop()
              break infoEntriesLoop
            }
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
            name,
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
          if (!(await editablePkgJson.save({ ignoreWhitespace: true }))) {
            debugFn(`skip: ${workspace}/package.json unchanged`)
            // Reset things just in case.
            if (ciEnv) {
              // eslint-disable-next-line no-await-in-loop
              await gitResetAndClean(ciEnv.baseBranch, cwd)
            }
            continue infosLoop
          }

          if (!hasAnnouncedWorkspace) {
            hasAnnouncedWorkspace = true
            workspaceLogCallCount = logger.logCallCount
          }

          const newId = `${name}@${applyRange(refRange, newVersion, rangeStyle)}`

          spinner?.start()
          spinner?.info(`Installing ${newId} in ${workspace}.`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await installer(pkgEnvDetails, {
              cwd,
              spinner,
            })
            const maybeLockSrc = maybeActualTree
              ? // eslint-disable-next-line no-await-in-loop
                await readLockfile(pkgEnvDetails.lockPath)
              : null
            if (maybeActualTree && maybeLockSrc) {
              actualTree = maybeActualTree
              // eslint-disable-next-line no-await-in-loop
              await afterInstall(
                editablePkgJson,
                name,
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
          if (!errored && ciEnv?.repoInfo) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const result = await gitUnstagedModifiedFiles(cwd)
              if (!result.ok) {
                logger.warn(
                  'Unexpected condition: Nothing to commit, skipping PR creation.',
                )
                continue
              }
              const moddedFilepaths = result.data.filter(filepath => {
                const basename = path.basename(filepath)
                return (
                  basename === 'package.json' ||
                  basename === pkgEnvDetails.lockName
                )
              })
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
                // eslint-disable-next-line no-await-in-loop
                const maybeActualTree = await installer(pkgEnvDetails, {
                  cwd,
                  spinner,
                })
                const maybeLockSrc = maybeActualTree
                  ? // eslint-disable-next-line no-await-in-loop
                    await readLockfile(pkgEnvDetails.lockPath)
                  : null
                if (maybeActualTree && maybeLockSrc) {
                  actualTree = maybeActualTree
                  continue infosLoop
                }
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

          if (ciEnv) {
            spinner?.start()
            // eslint-disable-next-line no-await-in-loop
            await gitResetAndClean(ciEnv.baseBranch, cwd)
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
            if (!ciEnv) {
              spinner?.start()
              // eslint-disable-next-line no-await-in-loop
              await revertInstall(
                editablePkgJson,
                name,
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
          }
          debugFn('name:', name)
          debugFn('increment: count', count + 1)
          if (++count >= limit) {
            cleanupInfoEntriesLoop()
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
    if (!isLastInfoEntry) {
      logger.logNewline()
    }
    cleanupInfoEntriesLoop()
  }

  spinner?.stop()

  // Or, did we change anything?
  return { ok: true, data: { fixed: true } }
}
