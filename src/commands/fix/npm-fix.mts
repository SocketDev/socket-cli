import path from 'node:path'

import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson,
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import {
  getBaseGitBranch,
  getSocketBranchName,
  getSocketCommitMessage,
  gitCreateAndPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from './git.mts'
import {
  cleanupOpenPrs,
  enablePrAutoMerge,
  getGitHubEnvRepoInfo,
  openPr,
  prExistForBranch,
  setGitRemoteGitHubRepoUrl,
} from './open-pr.mts'
import { getAlertsMapOptions } from './shared.mts'
import constants from '../../constants.mts'
import {
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
} from '../../shadow/npm/arborist/index.mts'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  getAlertsMapFromArborist,
  updateNode,
  updatePackageJsonFromNode,
} from '../../shadow/npm/arborist-helpers.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { removeNodeModules } from '../../utils/fs.mts'
import { globWorkspace } from '../../utils/glob.mts'
import { type RangeStyle, applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'

import type {
  ArboristInstance,
  NodeClass,
} from '../../shadow/npm/arborist/types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const { NPM } = constants

type InstallOptions = {
  cwd?: string | undefined
}

async function install(
  arb: ArboristInstance,
  options: InstallOptions,
): Promise<NodeClass | null> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  try {
    const newArb = new Arborist({ path: cwd })
    newArb.idealTree = await arb.buildIdealTree()
    const actualTree = await newArb.reify()
    arb.actualTree = actualTree
    return actualTree
  } catch {}
  return null
}

export async function npmFix(
  pkgEnvDetails: EnvDetails,
  {
    autoMerge,
    cwd,
    limit,
    purls,
    rangeStyle,
    test,
    testScript,
  }: {
    autoMerge: boolean
    cwd: string
    limit: number
    purls: string[]
    rangeStyle: RangeStyle
    test: boolean
    testScript: string
  },
) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner?.start()

  const { pkgPath: rootPath } = pkgEnvDetails

  const arb = new Arborist({
    path: rootPath,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  })
  // Calling arb.reify() creates the arb.diff object, nulls-out arb.idealTree,
  // and populates arb.actualTree.
  let actualTree = await arb.reify()

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(purls, getAlertsMapOptions({ limit }))
      : await getAlertsMapFromArborist(arb, getAlertsMapOptions({ limit }))
  } catch (e) {
    spinner?.stop()
    logger.error(
      (e as Error)?.message || 'Unknown Socket batch PURL API error.',
    )
    return
  }

  const infoByPkgName = getCveInfoFromAlertsMap(alertsMap, { limit })
  if (!infoByPkgName) {
    spinner?.stop()
    logger.info('No fixable vulns found.')
    return
  }

  // Lazily access constants.ENV properties.
  const token = constants.ENV.SOCKET_CLI_GITHUB_TOKEN
  const isCi = !!(
    constants.ENV.CI &&
    constants.ENV.GITHUB_ACTIONS &&
    constants.ENV.GITHUB_REPOSITORY &&
    token
  )
  const baseBranch = isCi ? getBaseGitBranch() : ''
  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath,
  )
  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!,
  ]

  const handleInstallFail = () => {
    logger.error(
      `Unexpected condition: ${pkgEnvDetails.agent} install failed.\n`,
    )
    logger.dedent()
    spinner?.dedent()
  }

  spinner?.stop()

  let count = 0

  const sortedInfoEntries = [...infoByPkgName.entries()].sort((a, b) =>
    naturalCompare(a[0], b[0]),
  )
  infoEntriesLoop: for (
    let i = 0, { length } = sortedInfoEntries;
    i < length;
    i += 1
  ) {
    const isLastInfoEntry = i === length - 1
    const { 0: name, 1: infos } = sortedInfoEntries[i]!

    logger.log(`Processing vulns for ${name}:`)
    logger.indent()
    spinner?.indent()

    if (getManifestData(NPM, name)) {
      debugFn(`Socket Optimize package exists for ${name}.`)
    }
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    if (!packument) {
      logger.warn(`Unexpected condition: No packument found for ${name}.\n`)
      logger.dedent()
      spinner?.dedent()
      continue infoEntriesLoop
    }

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

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.target?.version ?? n.version)
          .filter(Boolean),
      )

      if (!oldVersions.length) {
        debugFn(`${name} not found, skipping.\n`)
        // Skip to next package.
        logger.dedent()
        spinner?.dedent()
        continue infoEntriesLoop
      }

      // Always re-read the editable package.json to avoid stale mutations
      // across iterations.
      // eslint-disable-next-line no-await-in-loop
      const editablePkgJson = await readPackageJson(pkgJsonPath, {
        editable: true,
      })

      let hasAnnouncedWorkspace = false
      let workspaceLogCallCount = logger.logCallCount
      if (isDebug()) {
        debugFn(`Checking workspace ${workspace}.`)
        hasAnnouncedWorkspace = true
        workspaceLogCallCount = logger.logCallCount
      }

      oldVersionsLoop: for (const oldVersion of oldVersions) {
        const oldId = `${name}@${oldVersion}`
        const oldPurl = idToPurl(oldId)

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          debugFn(`${oldId} not found, skipping.`)
          continue oldVersionsLoop
        }

        infosLoop: for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange,
        } of infos.values()) {
          if (semver.gte(oldVersion, firstPatchedVersionIdentifier)) {
            debugFn(
              `${oldId} is >= ${firstPatchedVersionIdentifier}, skipping.`,
            )
            continue infosLoop
          }
          const newVersion = findBestPatchVersion(
            node,
            availableVersions,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier,
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

          const newVersionRange = applyRange(oldVersion, newVersion, rangeStyle)
          const newId = `${name}@${newVersionRange}`

          const revertData = {
            ...(editablePkgJson.content.dependencies && {
              dependencies: { ...editablePkgJson.content.dependencies },
            }),
            ...(editablePkgJson.content.optionalDependencies && {
              optionalDependencies: {
                ...editablePkgJson.content.optionalDependencies,
              },
            }),
            ...(editablePkgJson.content.peerDependencies && {
              peerDependencies: { ...editablePkgJson.content.peerDependencies },
            }),
          } as PackageJson

          updateNode(node, newVersion, newVersionPackument)
          updatePackageJsonFromNode(
            editablePkgJson,
            // eslint-disable-next-line no-await-in-loop
            await arb.buildIdealTree(),
            node,
            newVersion,
            rangeStyle,
          )
          // eslint-disable-next-line no-await-in-loop
          if (!(await editablePkgJson.save({ ignoreWhitespace: true }))) {
            debugFn(`${workspace}/package.json not changed, skipping.`)
            // Reset things just in case.
            if (isCi) {
              // eslint-disable-next-line no-await-in-loop
              await gitResetAndClean(baseBranch, cwd)
            }
            continue infosLoop
          }

          if (!hasAnnouncedWorkspace) {
            hasAnnouncedWorkspace = true
            workspaceLogCallCount = logger.logCallCount
          }

          spinner?.start()
          spinner?.info(`Installing ${newId} in ${workspace}.`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await install(arb, { cwd })
            if (maybeActualTree) {
              actualTree = maybeActualTree
              if (test) {
                spinner?.info(`Testing ${newId} in ${workspace}.`)
                // eslint-disable-next-line no-await-in-loop
                await runScript(testScript, [], { spinner, stdio: 'ignore' })
              }
              spinner?.success(`Fixed ${name} in ${workspace}.`)
            } else {
              errored = true
            }
          } catch (e) {
            errored = true
            error = e
          }

          spinner?.stop()

          if (!errored && isCi) {
            try {
              const moddedFilepaths =
                // eslint-disable-next-line no-await-in-loop
                (await gitUnstagedModifiedFiles(cwd)).filter(p => {
                  const basename = path.basename(p)
                  return (
                    basename === 'package.json' ||
                    basename === 'package-lock.json'
                  )
                })
              if (!moddedFilepaths.length) {
                logger.warn(
                  'Unexpected condition: Nothing to commit, skipping PR creation.',
                )
                continue infosLoop
              }

              const repoInfo = getGitHubEnvRepoInfo()!
              const branch = getSocketBranchName(oldPurl, newVersion, workspace)

              let skipPr = false
              if (
                // eslint-disable-next-line no-await-in-loop
                await prExistForBranch(repoInfo.owner, repoInfo.repo, branch)
              ) {
                skipPr = true
                debugFn(`Branch "${branch}" exists, skipping PR creation.`)
              }
              // eslint-disable-next-line no-await-in-loop
              else if (await gitRemoteBranchExists(branch, cwd)) {
                skipPr = true
                debugFn(
                  `Remote branch "${branch}" exists, skipping PR creation.`,
                )
              } else if (
                // eslint-disable-next-line no-await-in-loop
                !(await gitCreateAndPushBranch(
                  branch,
                  getSocketCommitMessage(oldPurl, newVersion, workspace),
                  moddedFilepaths,
                  {
                    cwd,
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
                await gitResetAndClean(baseBranch, cwd)
                // eslint-disable-next-line no-await-in-loop
                const maybeActualTree = await install(arb, { cwd })
                if (!maybeActualTree) {
                  // Exit early if install fails.
                  handleInstallFail()
                  return
                }
                actualTree = maybeActualTree
                continue infosLoop
              }

              // eslint-disable-next-line no-await-in-loop
              await Promise.allSettled([
                setGitRemoteGitHubRepoUrl(
                  repoInfo.owner,
                  repoInfo.repo,
                  token,
                  cwd,
                ),
                cleanupOpenPrs(repoInfo.owner, repoInfo.repo, newVersion, {
                  purl: oldPurl,
                  workspace,
                }),
              ])
              // eslint-disable-next-line no-await-in-loop
              const prResponse = await openPr(
                repoInfo.owner,
                repoInfo.repo,
                branch,
                oldPurl,
                newVersion,
                {
                  baseBranch,
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

          if (isCi) {
            spinner?.start()
            // eslint-disable-next-line no-await-in-loop
            await gitResetAndClean(baseBranch, cwd)
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await install(arb, { cwd })
            spinner?.stop()
            if (maybeActualTree) {
              actualTree = maybeActualTree
            } else {
              errored = true
            }
          }
          if (errored) {
            if (!isCi) {
              spinner?.start()
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await Promise.all([
                removeNodeModules(cwd),
                editablePkgJson.save({ ignoreWhitespace: true }),
              ])
              // eslint-disable-next-line no-await-in-loop
              const maybeActualTree = await install(arb, { cwd })
              spinner?.stop()
              if (!maybeActualTree) {
                // Exit early if install fails.
                handleInstallFail()
                return
              }
              actualTree = maybeActualTree
            }
            logger.fail(`Update failed for ${oldId} in ${workspace}.`, error)
          }
          if (++count >= limit) {
            logger.dedent()
            spinner?.dedent()
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
    logger.dedent()
    spinner?.dedent()
  }

  spinner?.stop()
}
