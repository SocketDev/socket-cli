import path from 'node:path'

import Config from '@npmcli/config'
import {
  definitions,
  flatten,
  shorthands,
  // @ts-ignore
} from '@npmcli/config/lib/definitions'
import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson,
  resolvePackageName,
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import { getActiveBranchesForPackage } from './fix-branch-helpers.mts'
import { getCiEnv, getOpenPrsForEnvironment } from './fix-env-helpers.mts'
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
import { getPurlObject } from '../../utils/purl.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'

import type {
  ArboristInstance,
  NodeClass,
} from '../../shadow/npm/arborist/types.mts'
import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

type InstallOptions = {
  cwd?: string | undefined
}

async function install(
  pkgEnvDetails: EnvDetails,
  arb: ArboristInstance,
  options: InstallOptions,
): Promise<NodeClass | null> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  try {
    const config = new Config({
      argv: [],
      cwd,
      definitions,
      flatten,
      npmPath: pkgEnvDetails.agentExecPath,
      shorthands,
    })
    await config.load()

    const legacyPeerDeps = config.get('legacy-peer-deps')
    const newArb = new Arborist({
      legacyPeerDeps,
      path: cwd,
    })
    newArb.idealTree = await arb.buildIdealTree()
    await newArb.reify()
    arb.actualTree = null
    await arb.loadActual()
    return arb.actualTree
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
): Promise<CResult<{ fixed: boolean }>> {
  // Lazily access constants.spinner.
  const { spinner } = constants
  const { pkgPath: rootPath } = pkgEnvDetails

  spinner?.start()

  const ciEnv = await getCiEnv()
  const openPrs = ciEnv ? await getOpenPrsForEnvironment(ciEnv) : []

  let count = 0

  let arb = new Arborist({
    path: rootPath,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  })
  // Calling arb.reify() creates the arb.diff object, nulls-out arb.idealTree,
  // and populates arb.actualTree.
  await arb.reify()
  await arb.loadActual()
  let actualTree = arb.actualTree!

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(
          purls,
          getAlertsMapOptions({ limit: Math.max(limit, openPrs.length) }),
        )
      : await getAlertsMapFromArborist(
          arb,
          getAlertsMapOptions({ limit: Math.max(limit, openPrs.length) }),
        )
  } catch (e) {
    spinner?.stop()
    debugFn('catch: PURL API\n', e)
    return {
      ok: false,
      message: 'API Error',
      cause: (e as Error)?.message || 'Unknown Socket batch PURL API error.',
    }
  }

  const infoByPartialPurl = getCveInfoFromAlertsMap(alertsMap, {
    limit: Math.max(limit, openPrs.length),
  })
  if (!infoByPartialPurl) {
    spinner?.stop()
    logger.info('No fixable vulns found.')
    return { ok: true, data: { fixed: false } }
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
      message: 'Installation failure',
      cause: `Unexpected condition: ${pkgEnvDetails.agent} install failed.`,
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
      arb = new Arborist({
        path: rootPath,
        ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
      })
      // eslint-disable-next-line no-await-in-loop
      await arb.loadActual()
      actualTree = arb.actualTree!
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

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.target?.version ?? n.version)
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
        } of infos.values()) {
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

          spinner?.start()
          spinner?.info(`Installing ${newId} in ${workspace}.`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await install(pkgEnvDetails, arb, { cwd })
            if (maybeActualTree) {
              actualTree = maybeActualTree
              if (test) {
                spinner?.info(`Testing ${newId} in ${workspace}.`)
                // eslint-disable-next-line no-await-in-loop
                await runScript(testScript, [], { spinner, stdio: 'ignore' })
              }
              spinner?.success(`Fixed ${name} in ${workspace}.`)
              seenVersions.add(newVersion)
            } else {
              errored = true
            }
          } catch (e) {
            errored = true
            error = e
          }

          spinner?.stop()

          // Check repoInfo to make TypeScript happy.
          if (!errored && ciEnv?.repoInfo) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const result = await gitUnstagedModifiedFiles(cwd)
              if (!result.ok) {
                // Do we fail if this fails? If this git command
                // fails then probably other git commands do too?
                logger.warn(
                  'Unexpected condition: Nothing to commit, skipping PR creation.',
                )
                continue infosLoop
              }
              const moddedFilepaths = result.data.filter(p => {
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
                const maybeActualTree = await install(pkgEnvDetails, arb, {
                  cwd,
                })
                if (maybeActualTree) {
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
            const maybeActualTree = await install(pkgEnvDetails, arb, { cwd })
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
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await Promise.all([
                removeNodeModules(cwd),
                editablePkgJson.save({ ignoreWhitespace: true }),
              ])
              // eslint-disable-next-line no-await-in-loop
              const maybeActualTree = await install(pkgEnvDetails, arb, { cwd })
              spinner?.stop()
              if (maybeActualTree) {
                actualTree = maybeActualTree
              } else {
                // Exit early if install fails.
                return handleInstallFail()
              }
            }
            logger.fail(`Update failed for ${oldId} in ${workspace}.`, error)
          }
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
