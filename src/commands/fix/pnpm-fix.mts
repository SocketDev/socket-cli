import { existsSync, promises as fs } from 'node:fs'
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
  resolvePackageName,
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'

import {
  createSocketBranchParser,
  getBaseGitBranch,
  getSocketBranchFullNameComponent,
  getSocketBranchName,
  getSocketBranchPurlTypeComponent,
  getSocketCommitMessage,
  gitCreateAndPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from './git.mts'
import {
  cleanupOpenPrs,
  enablePrAutoMerge,
  getGithubEnvRepoInfo,
  getOpenSocketPrs,
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
  updatePackageJsonFromNode,
} from '../../shadow/npm/arborist-helpers.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../utils/alerts-map.mts'
import { removeNodeModules } from '../../utils/fs.mts'
import { globWorkspace } from '../../utils/glob.mts'
import {
  extractOverridesFromPnpmLockfileContent,
  parsePnpmLockfile,
  parsePnpmLockfileVersion,
  readPnpmLockfile,
} from '../../utils/pnpm.mts'
import { getPurlObject } from '../../utils/purl.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'

import type { SocketBranchParseResult } from './git.mts'
import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult, StringKeyValueObject } from '../../types.mts'
import type { PURL_Type } from '../../utils/alert/artifact.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { RangeStyle } from '../../utils/semver.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { OVERRIDES, PNPM } = constants

type InstallOptions = {
  args?: string[] | undefined
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

async function getActualTree(cwd: string = process.cwd()): Promise<NodeClass> {
  // @npmcli/arborist DOES have partial support for pnpm structured node_modules
  // folders. However, support is iffy resulting in unhappy path errors and hangs.
  // So, to avoid the unhappy path, we restrict our usage to --dry-run loading
  // of the node_modules folder.
  const arb = new Arborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  })
  return await arb.loadActual()
}

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
): Promise<NodeClass | null> {
  const { args, cwd, spinner } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  try {
    await runAgentInstall(pkgEnvDetails, {
      args: [
        ...(args ?? []),
        // Enable pnpm updates to pnpm-lock.yaml in CI environments.
        // https://pnpm.io/cli/install#--frozen-lockfile
        '--no-frozen-lockfile',
        // Enable a non-interactive pnpm install
        // https://github.com/pnpm/pnpm/issues/6778
        '--config.confirmModulesPurge=false',
      ],
      spinner,
      stdio: isDebug() ? 'inherit' : 'ignore',
    })
    return await getActualTree(cwd)
  } catch {}
  return null
}

export async function pnpmFix(
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

  // Lazily access constants.ENV properties.
  const gitEmail = constants.ENV.SOCKET_CLI_GIT_USER_EMAIL
  const gitUser = constants.ENV.SOCKET_CLI_GIT_USER_NAME
  const githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN

  const isCi = !!(
    constants.ENV.CI &&
    constants.ENV.GITHUB_ACTIONS &&
    constants.ENV.GITHUB_REPOSITORY &&
    gitEmail &&
    gitUser &&
    githubToken
  )

  const repoInfo = isCi ? getGithubEnvRepoInfo()! : null

  spinner?.start()

  const openPrs =
    // Check repoInfo to make TypeScript happy.
    isCi && repoInfo
      ? await getOpenSocketPrs(repoInfo.owner, repoInfo.repo, {
          author: gitUser,
        })
      : []

  if (openPrs.length) {
    debugFn(`found: ${openPrs.length} open PRs\n`, openPrs)
  } else {
    debugFn('miss: 0 open PRs found')
  }

  let count = 0

  let actualTree: NodeClass | undefined
  const lockfilePath = path.join(rootPath, 'pnpm-lock.yaml')
  let lockfileContent = await readPnpmLockfile(lockfilePath)

  // If pnpm-lock.yaml does NOT exist then install with pnpm to create it.
  if (!lockfileContent) {
    const maybeActualTree = await install(pkgEnvDetails, { cwd, spinner })
    const maybeLockfileContent = maybeActualTree
      ? await readPnpmLockfile(lockfilePath)
      : null
    if (maybeActualTree) {
      actualTree = maybeActualTree
      lockfileContent = maybeLockfileContent
    }
  }

  let lockfile = parsePnpmLockfile(lockfileContent)
  // Update pnpm-lock.yaml if its version is older than what the installed pnpm
  // produces.
  if (
    lockfileContent &&
    pkgEnvDetails.agentVersion.major >= 10 &&
    (parsePnpmLockfileVersion(lockfile?.lockfileVersion)?.major ?? 0) <= 6
  ) {
    const maybeActualTree = await install(pkgEnvDetails, {
      args: ['--lockfile-only'],
      cwd,
      spinner,
    })
    const maybeLockfileContent = maybeActualTree
      ? await readPnpmLockfile(lockfilePath)
      : null
    if (maybeActualTree && maybeLockfileContent) {
      actualTree = maybeActualTree
      lockfileContent = maybeLockfileContent
      lockfile = parsePnpmLockfile(lockfileContent)
    } else {
      lockfile = null
    }
  }

  // Exit early if pnpm-lock.yaml is not found or usable.
  // Check !lockfileContent to make TypeScript happy.
  if (!lockfile || !lockfileContent) {
    spinner?.stop()
    return {
      ok: false,
      message: 'Missing lockfile',
      cause: 'Required pnpm-lock.yaml not found or usable',
    }
  }

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(
          purls,
          getAlertsMapOptions({ limit: limit + openPrs.length }),
        )
      : await getAlertsMapFromPnpmLockfile(
          lockfile,
          getAlertsMapOptions({ limit: limit + openPrs.length }),
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
    limit: limit + openPrs.length,
  })
  if (!infoByPartialPurl) {
    spinner?.stop()
    logger.info('No fixable vulns found.')
    return { ok: true, data: { fixed: false } }
  }

  const baseBranch = isCi ? getBaseGitBranch() : ''
  const branchParser = isCi ? createSocketBranchParser() : null
  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath,
  )
  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!,
  ]
  const sortedInfoEntries = [...infoByPartialPurl.entries()].sort((a, b) =>
    naturalCompare(a[0], b[0]),
  )

  const handleInstallFail = (): CResult<{ fixed: boolean }> => {
    logger.dedent()
    spinner?.dedent()

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

    const infos = [...infoEntry[1].values()]
    if (!infos.length) {
      continue infoEntriesLoop
    }

    const activeBranches: SocketBranchParseResult[] = []
    if (isCi) {
      const branchFullName = getSocketBranchFullNameComponent(partialPurlObj)
      const branchPurlType = getSocketBranchPurlTypeComponent(partialPurlObj)
      for (const pr of openPrs) {
        const parsedBranch = branchParser!(pr.headRefName)
        if (
          branchPurlType === parsedBranch?.type &&
          branchFullName === parsedBranch?.fullName
        ) {
          activeBranches.push(parsedBranch)
        }
      }
      if (activeBranches.length) {
        debugFn(
          `found: ${activeBranches.length} active branches\n`,
          activeBranches,
        )
      } else if (openPrs.length) {
        debugFn('miss: 0 active branches found')
      }
    }

    logger.log(`Processing vulns for ${name}:`)
    logger.indent()
    spinner?.indent()

    if (getManifestData(partialPurlObj.type as PURL_Type, name)) {
      debugFn(`found: Socket Optimize variant for ${name}`)
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

      // actualTree may not be defined on the first iteration of pkgJsonPathsLoop.
      if (!actualTree) {
        if (!isCi) {
          // eslint-disable-next-line no-await-in-loop
          await removeNodeModules(cwd)
        }
        const maybeActualTree =
          isCi && existsSync(path.join(rootPath, 'node_modules'))
            ? // eslint-disable-next-line no-await-in-loop
              await getActualTree(cwd)
            : // eslint-disable-next-line no-await-in-loop
              await install(pkgEnvDetails, { cwd, spinner })
        const maybeLockfileContent = maybeActualTree
          ? // eslint-disable-next-line no-await-in-loop
            await readPnpmLockfile(lockfilePath)
          : null
        if (maybeActualTree && maybeLockfileContent) {
          actualTree = maybeActualTree
          lockfileContent = maybeLockfileContent
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
      // Get current overrides for revert logic.
      const oldPnpmSection = editablePkgJson.content[PNPM] as
        | StringKeyValueObject
        | undefined

      const oldOverrides = oldPnpmSection?.[OVERRIDES] as
        | Record<string, string>
        | undefined

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
          if (semver.gte(oldVersion, firstPatchedVersionIdentifier)) {
            debugFn(`skip: ${oldId} is >= ${firstPatchedVersionIdentifier}`)
            continue infosLoop
          }

          const newVersion = findBestPatchVersion(
            node,
            availableVersions,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier,
          )

          if (activeBranches.find(b => b.newVersion === newVersion)) {
            debugFn(`skip: open PR found for ${name}@${newVersion}`)
            if (++count >= limit) {
              logger.dedent()
              spinner?.dedent()
              break infoEntriesLoop
            }
            continue infosLoop
          }

          const newVersionPackument = newVersion
            ? packument.versions[newVersion]
            : undefined

          if (!(newVersion && newVersionPackument)) {
            warningsForAfter.add(
              `${oldId} not updated: requires >=${firstPatchedVersionIdentifier}`,
            )
            continue infosLoop
          }

          const overrideKey = `${name}@${vulnerableVersionRange}`
          const newVersionRange = applyRange(
            oldOverrides?.[overrideKey] ?? oldVersion,
            newVersion,
            rangeStyle,
          )
          const newId = `${name}@${newVersionRange}`

          const updateOverrides = isWorkspaceRoot
            ? ({
                [PNPM]: {
                  ...oldPnpmSection,
                  [OVERRIDES]: {
                    ...oldOverrides,
                    [overrideKey]: newVersionRange,
                  },
                },
              } as PackageJson)
            : undefined

          const revertOverrides = (
            isWorkspaceRoot
              ? {
                  [PNPM]: oldPnpmSection
                    ? {
                        ...oldPnpmSection,
                        [OVERRIDES]:
                          oldOverrides && Object.keys(oldOverrides).length > 1
                            ? {
                                ...oldOverrides,
                                [overrideKey]: undefined,
                              }
                            : undefined,
                      }
                    : undefined,
                }
              : {}
          ) as PackageJson

          const revertData = {
            ...revertOverrides,
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

          if (updateOverrides) {
            // Update overrides in the root package.json so that when `pnpm install`
            // generates pnpm-lock.yaml it updates transitive dependencies too.
            editablePkgJson.update(updateOverrides)
          }
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
            const revertOverridesContent =
              extractOverridesFromPnpmLockfileContent(lockfileContent)
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await install(pkgEnvDetails, {
              cwd,
              spinner,
            })
            const maybeLockfileContent = maybeActualTree
              ? // eslint-disable-next-line no-await-in-loop
                await readPnpmLockfile(lockfilePath)
              : null
            if (maybeActualTree && maybeLockfileContent) {
              actualTree = maybeActualTree
              lockfileContent = maybeLockfileContent
              // Revert overrides metadata in package.json now that pnpm-lock.yaml
              // has been updated.
              editablePkgJson.update(revertOverrides)
              // eslint-disable-next-line no-await-in-loop
              await editablePkgJson.save({ ignoreWhitespace: true })
              const updatedOverridesContent =
                extractOverridesFromPnpmLockfileContent(lockfileContent)
              if (updatedOverridesContent) {
                lockfileContent = lockfileContent!.replace(
                  updatedOverridesContent,
                  revertOverridesContent,
                )
                // eslint-disable-next-line no-await-in-loop
                await fs.writeFile(lockfilePath, lockfileContent, 'utf8')
              }
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
            error = e
            errored = true
          }

          spinner?.stop()

          // Check repoInfo to make TypeScript happy.
          if (!errored && isCi && repoInfo) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const result = await gitUnstagedModifiedFiles(cwd)
              if (!result.ok) {
                logger.warn(
                  'Unexpected condition: Nothing to commit, skipping PR creation.',
                )
                continue
              }
              const moddedFilepaths = result.data.filter(p => {
                const basename = path.basename(p)
                return (
                  basename === 'package.json' || basename === 'pnpm-lock.yaml'
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
                await prExistForBranch(repoInfo.owner, repoInfo.repo, branch)
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
                    email: gitEmail,
                    user: gitUser,
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
                const maybeActualTree = await install(pkgEnvDetails, {
                  cwd,
                  spinner,
                })
                const maybeLockfileContent = maybeActualTree
                  ? // eslint-disable-next-line no-await-in-loop
                    await readPnpmLockfile(lockfilePath)
                  : null
                if (maybeActualTree && maybeLockfileContent) {
                  actualTree = maybeActualTree
                  lockfileContent = maybeLockfileContent
                  continue infosLoop
                }
                // Exit early if install fails.
                return handleInstallFail()
              }

              // eslint-disable-next-line no-await-in-loop
              await Promise.allSettled([
                setGitRemoteGithubRepoUrl(
                  repoInfo.owner,
                  repoInfo.repo,
                  githubToken,
                  cwd,
                ),
                cleanupOpenPrs(repoInfo.owner, repoInfo.repo, {
                  newVersion,
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
            const maybeActualTree = await install(pkgEnvDetails, {
              cwd,
              spinner,
            })
            const maybeLockfileContent = maybeActualTree
              ? // eslint-disable-next-line no-await-in-loop
                await readPnpmLockfile(lockfilePath)
              : null
            spinner?.stop()
            if (maybeActualTree) {
              actualTree = maybeActualTree
              lockfileContent = maybeLockfileContent
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
              const maybeActualTree = await install(pkgEnvDetails, {
                cwd,
                spinner,
              })
              const maybeLockfileContent = maybeActualTree
                ? // eslint-disable-next-line no-await-in-loop
                  await readPnpmLockfile(lockfilePath)
                : null
              spinner?.stop()
              if (maybeActualTree) {
                actualTree = maybeActualTree
                lockfileContent = maybeLockfileContent
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

  // Or, did we change anything?
  return { ok: true, data: { fixed: true } }
}
