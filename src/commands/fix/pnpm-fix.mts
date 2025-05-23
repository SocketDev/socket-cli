import { existsSync } from 'node:fs'
import path from 'node:path'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
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
import { getAlertMapOptions } from './shared.mts'
import constants from '../../constants.mts'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist,
} from '../../shadow/npm/arborist/lib/arborist/index.mts'
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
  parsePnpmLockfileVersion,
  readPnpmLockfile,
} from '../../utils/pnpm.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'

import type { NormalizedFixOptions } from './types.mts'
import type { SafeNode } from '../../shadow/npm/arborist/lib/node.mts'
import type { StringKeyValueObject } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { DRY_RUN_NOT_SAVING, NPM, OVERRIDES, PNPM } = constants

async function getActualTree(cwd: string = process.cwd()): Promise<SafeNode> {
  // npm DOES have some support pnpm structured node_modules folders. However,
  // the support is a little iffy where the unhappy path errors. So, we restrict
  // our usage to --dry-run loading of the node_modules folder.
  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  })
  return await arb.loadActual()
}

type InstallOptions = {
  args?: string[] | undefined
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
): Promise<SafeNode | null> {
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
    dryRun,
    limit,
    purls,
    rangeStyle,
    test,
    testScript,
  }: NormalizedFixOptions,
) {
  if (dryRun) {
    logger.log(DRY_RUN_NOT_SAVING)
    return
  }
  // Lazily access constants.spinner.
  const { spinner } = constants
  const { pkgPath: rootPath } = pkgEnvDetails

  spinner?.start()

  let actualTree: SafeNode | undefined
  const lockfilePath = path.join(rootPath, 'pnpm-lock.yaml')
  let lockfile = await readPnpmLockfile(lockfilePath)

  // If pnpm-lock.yaml does NOT exist then install with pnpm to create it.
  if (!lockfile) {
    const maybeActualTree = await install(pkgEnvDetails, { cwd, spinner })
    if (maybeActualTree) {
      actualTree = maybeActualTree
      lockfile = await readPnpmLockfile(lockfilePath)
    }
  }
  // Update pnpm-lock.yaml if its version is older than what the installed pnpm
  // produces.
  if (
    lockfile &&
    pkgEnvDetails.agentVersion.major >= 10 &&
    parsePnpmLockfileVersion(lockfile.lockfileVersion).major <= 6
  ) {
    const maybeActualTree = await install(pkgEnvDetails, {
      args: ['--lockfile-only'],
      cwd,
      spinner,
    })
    if (maybeActualTree) {
      actualTree = maybeActualTree
      lockfile = await readPnpmLockfile(lockfilePath)
    }
  }

  // Exit early if pnpm-lock.yaml is not found.
  if (!lockfile) {
    spinner?.stop()
    logger.error('Required pnpm-lock.yaml not found.')
    return
  }

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(purls, getAlertMapOptions({ limit }))
      : await getAlertsMapFromPnpmLockfile(
          lockfile,
          getAlertMapOptions({ limit }),
        )
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
  const token =
    constants.ENV.SOCKET_SECURITY_GITHUB_PAT || constants.ENV.GITHUB_TOKEN
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
      debugLog(`Socket Optimize package exists for ${name}.`)
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
      const workspaceName = isWorkspaceRoot
        ? 'root'
        : path.relative(rootPath, pkgPath)

      // actualTree may not be defined on the first iteration of pkgJsonPathsLoop.
      if (!actualTree) {
        const maybeActualTree = existsSync(path.join(rootPath, 'node_modules'))
          ? // eslint-disable-next-line no-await-in-loop
            await getActualTree(cwd)
          : // eslint-disable-next-line no-await-in-loop
            await install(pkgEnvDetails, { cwd, spinner })
        if (maybeActualTree) {
          actualTree = maybeActualTree
        }
      }
      if (!actualTree) {
        // Exit early if install fails.
        handleInstallFail()
        return
      }

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.version)
          .filter(Boolean),
      )

      if (!oldVersions.length) {
        logger.warn(
          `Unexpected condition: Lockfile entries not found for ${name}.\n`,
        )
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
        debugLog(`Checking workspace: ${workspaceName}`)
        hasAnnouncedWorkspace = true
        workspaceLogCallCount = logger.logCallCount
      }

      oldVersionsLoop: for (const oldVersion of oldVersions) {
        const oldId = `${name}@${oldVersion}`
        const oldPurl = idToPurl(oldId)

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          if (hasAnnouncedWorkspace) {
            logger.warn(
              `Unexpected condition: Arborist node not found, skipping ${oldId}.`,
            )
          }
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

          const overrideKey = `${name}@${vulnerableVersionRange}`
          const newVersionRange = applyRange(
            oldOverrides?.[overrideKey] ?? oldVersion,
            newVersion,
            rangeStyle,
          )
          const newId = `${name}@${newVersionRange}`
          const updateData = isWorkspaceRoot
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

          const revertData = {
            ...(isWorkspaceRoot
              ? {
                  [PNPM]: {
                    ...oldPnpmSection,
                    [OVERRIDES]:
                      oldOverrides && Object.keys(oldOverrides).length > 1
                        ? {
                            ...oldOverrides,
                            [overrideKey]: undefined,
                          }
                        : undefined,
                  },
                }
              : {}),
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

          if (updateData) {
            editablePkgJson.update(updateData)
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
            debugLog(`${workspaceName}/package.json not changed, skipping.`)
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
          spinner?.info(`Installing ${newId} in ${workspaceName}.`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            const maybeActualTree = await install(pkgEnvDetails, {
              cwd,
              spinner,
            })
            if (maybeActualTree) {
              actualTree = maybeActualTree
              if (test) {
                spinner?.info(`Testing ${newId} in ${workspaceName}.`)
                // eslint-disable-next-line no-await-in-loop
                await runScript(testScript, [], { spinner, stdio: 'ignore' })
              }
              spinner?.success(`Fixed ${name} in ${workspaceName}.`)
            } else {
              errored = true
            }
          } catch (e) {
            error = e
            errored = true
          }

          spinner?.stop()

          if (!errored && isCi) {
            try {
              const moddedFilepaths =
                // eslint-disable-next-line no-await-in-loop
                (await gitUnstagedModifiedFiles(cwd)).filter(p => {
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

              const repoInfo = getGitHubEnvRepoInfo()!
              const branch = getSocketBranchName(
                oldPurl,
                newVersion,
                workspaceName,
              )
              let skipPr = false
              if (
                // eslint-disable-next-line no-await-in-loop
                await prExistForBranch(repoInfo.owner, repoInfo.repo, branch)
              ) {
                skipPr = true
                debugLog(`Branch "${branch}" exists, skipping PR creation.`)
              }
              // eslint-disable-next-line no-await-in-loop
              else if (await gitRemoteBranchExists(branch, cwd)) {
                skipPr = true
                debugLog(
                  `Remote branch "${branch}" exists, skipping PR creation.`,
                )
              } else if (
                // eslint-disable-next-line no-await-in-loop
                !(await gitCreateAndPushBranch(
                  branch,
                  getSocketCommitMessage(oldPurl, newVersion, workspaceName),
                  moddedFilepaths,
                  cwd,
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
                cleanupOpenPrs(
                  repoInfo.owner,
                  repoInfo.repo,
                  oldPurl,
                  newVersion,
                  {
                    workspaceName,
                  },
                ),
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
                  workspaceName,
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
              const maybeActualTree = await install(pkgEnvDetails, {
                cwd,
                spinner,
              })
              spinner?.stop()
              if (!maybeActualTree) {
                // Exit early if install fails.
                handleInstallFail()
                return
              }
              actualTree = maybeActualTree
            }
            logger.fail(
              `Update failed for ${oldId} in ${workspaceName}.`,
              ...(error ? [error] : []),
            )
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
