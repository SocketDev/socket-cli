import path from 'node:path'

import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import {
  getBaseGitBranch,
  getSocketBranchName,
  getSocketCommitMessage,
  gitCleanFdx,
  gitCreateAndPushBranchIfNeeded,
  gitHardReset
} from './git'
import {
  doesPullRequestExistForBranch,
  enableAutoMerge,
  getGitHubEnvRepoInfo,
  openGitHubPullRequest
} from './open-pr'
import { alertMapOptions } from './shared'
import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import { runAgentInstall } from '../../utils/agent'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls
} from '../../utils/alerts-map'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { removeNodeModules } from '../../utils/fs'
import { globWorkspace } from '../../utils/glob'
import { applyRange } from '../../utils/semver'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'

import type { NormalizedFixOptions } from './types'
import type { SafeNode } from '../../shadow/npm/arborist/lib/node'
import type { StringKeyValueObject } from '../../types'
import type { EnvDetails } from '../../utils/package-environment'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { CI, NPM, OVERRIDES, PNPM } = constants

async function getActualTree(cwd: string = process.cwd()): Promise<SafeNode> {
  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  return await arb.loadActual()
}

type InstallOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions
): Promise<SafeNode> {
  const { cwd, spinner } = { __proto__: null, ...options } as InstallOptions
  await runAgentInstall(pkgEnvDetails, {
    args: ['--no-frozen-lockfile'],
    spinner,
    stdio: isDebug() ? 'inherit' : 'ignore'
  })
  return await getActualTree(cwd)
}

async function readLockfile(pkgPath: string): Promise<LockfileObject | null> {
  return await readWantedLockfile(pkgPath, {
    ignoreIncompatible: false
  })
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  {
    autoMerge,
    cwd,
    purls,
    rangeStyle,
    spinner,
    test,
    testScript
  }: NormalizedFixOptions
) {
  spinner?.start()

  const { pkgPath: rootPath } = pkgEnvDetails
  let lockfile = await readLockfile(rootPath)
  if (!lockfile) {
    await install(pkgEnvDetails, { cwd, spinner })
    lockfile = await readLockfile(rootPath)
    if (!lockfile) {
      spinner?.stop()
      logger.error('Required pnpm-lock.yaml not found.')
      return
    }
  }

  const alertsMap = purls.length
    ? await getAlertsMapFromPurls(purls, alertMapOptions)
    : await getAlertsMapFromPnpmLockfile(lockfile, alertMapOptions)

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    spinner?.stop()
    logger.info('No fixable vulnerabilities found.')
    return
  }

  // Lazily access constants.ENV[CI].
  const isCi = constants.ENV[CI]
  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath
  )
  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!
  ]

  for (const { 0: name, 1: infos } of infoByPkg) {
    debugLog(`Processing vulnerable package: ${name}`)

    if (getManifestData(NPM, name)) {
      spinner?.info(`Socket Optimize package for ${name} exists, skipping`)
      continue
    }
    if (!infos.length) {
      debugLog(`No vuln info found for ${name}`)
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    if (!packument) {
      debugLog(`No packument found for ${name}`)
      continue
    }

    const availableVersions = Object.keys(packument.versions)
    const fixedSpecs = new Set<string>()

    for (const pkgJsonPath of pkgJsonPaths) {
      const pkgPath = path.dirname(pkgJsonPath)
      const isWorkspaceRoot =
        pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
      const workspaceName = isWorkspaceRoot
        ? 'root'
        : path.relative(rootPath, pkgPath)

      debugLog(`Checking workspace: ${workspaceName}`)

      // eslint-disable-next-line no-await-in-loop
      let actualTree = await getActualTree(cwd)

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.target?.version ?? n.version)
          .filter(Boolean)
      )
      if (!oldVersions.length) {
        debugLog(`Lockfile entries not found for ${name}`)
        continue
      }

      // Always re-read the editable package.json to avoid stale mutations
      // across iterations.
      // eslint-disable-next-line no-await-in-loop
      const editablePkgJson = await readPackageJson(pkgJsonPath, {
        editable: true
      })
      // Get current overrides for revert logic
      const oldPnpmSection = editablePkgJson.content[PNPM] as
        | StringKeyValueObject
        | undefined
      const oldOverrides = oldPnpmSection?.[OVERRIDES] as
        | Record<string, string>
        | undefined

      for (const oldVersion of oldVersions) {
        const oldSpec = `${name}@${oldVersion}`
        const oldPurl = `pkg:npm/${oldSpec}`

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          debugLog(`Arborist node not found, skipping ${oldSpec}`)
          continue
        }

        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of infos) {
          const newVersion = findBestPatchVersion(
            node,
            availableVersions,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier
          )
          const newVersionPackument = newVersion
            ? packument.versions[newVersion]
            : undefined

          if (!(newVersion && newVersionPackument)) {
            debugLog(
              `No suitable update. ${oldSpec} needs >=${firstPatchedVersionIdentifier}, skipping`
            )
            continue
          }

          const overrideKey = `${name}@${vulnerableVersionRange}`
          const newVersionRange = applyRange(
            oldOverrides?.[overrideKey] ?? oldVersion,
            newVersion,
            rangeStyle
          )
          const newSpec = `${name}@${newVersionRange}`
          const newSpecKey = `${workspaceName}:${newSpec}`

          if (fixedSpecs.has(newSpecKey)) {
            debugLog(`Already fixed ${newSpec} in ${workspaceName}, skipping`)
            continue
          }

          const updateData = isWorkspaceRoot
            ? ({
                [PNPM]: {
                  ...oldPnpmSection,
                  [OVERRIDES]: {
                    ...oldOverrides,
                    [overrideKey]: newVersionRange
                  }
                }
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
                            [overrideKey]: undefined
                          }
                        : undefined
                  }
                }
              : {}),
            ...(editablePkgJson.content.dependencies && {
              dependencies: editablePkgJson.content.dependencies
            }),
            ...(editablePkgJson.content.optionalDependencies && {
              optionalDependencies: editablePkgJson.content.optionalDependencies
            }),
            ...(editablePkgJson.content.peerDependencies && {
              peerDependencies: editablePkgJson.content.peerDependencies
            })
          } as PackageJson

          if (updateData) {
            editablePkgJson.update(updateData)
          }
          updatePackageJsonFromNode(
            editablePkgJson,
            actualTree,
            node,
            newVersion,
            rangeStyle
          )
          // eslint-disable-next-line no-await-in-loop
          if (!(await editablePkgJson.save())) {
            debugLog(`Nothing changed for ${workspaceName}, skipping install`)
            continue
          }

          spinner?.info(`Installing ${newSpec} in ${workspaceName}`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { cwd, spinner })
            if (test) {
              spinner?.info(`Testing ${newSpec} in ${workspaceName}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            fixedSpecs.add(newSpecKey)
            spinner?.successAndStop(`Fixed ${name} in ${workspaceName}`)
            spinner?.start()
          } catch (e) {
            error = e
            errored = true
          }

          const baseBranch = isCi ? getBaseGitBranch() : ''
          if (!errored && isCi) {
            const branch = getSocketBranchName(
              oldPurl,
              newVersion,
              workspaceName
            )
            try {
              const { owner, repo } = getGitHubEnvRepoInfo()
              if (
                // eslint-disable-next-line no-await-in-loop
                (await doesPullRequestExistForBranch(owner, repo, branch)) ||
                // eslint-disable-next-line no-await-in-loop
                !(await gitCreateAndPushBranchIfNeeded(
                  branch,
                  getSocketCommitMessage(oldPurl, newVersion, workspaceName),
                  cwd
                ))
              ) {
                continue
              }
              // eslint-disable-next-line no-await-in-loop
              const prResponse = await openGitHubPullRequest(
                owner,
                repo,
                baseBranch,
                branch,
                oldPurl,
                newVersion,
                {
                  cwd,
                  workspaceName
                }
              )
              if (prResponse) {
                const { data } = prResponse
                spinner?.info(`Opened PR #${data.number}.`)
                if (autoMerge) {
                  // eslint-disable-next-line no-await-in-loop
                  await enableAutoMerge(data)
                }
              }
            } catch (e) {
              error = e
              errored = true
            }
          }

          if (isCi) {
            // eslint-disable-next-line no-await-in-loop
            await gitHardReset(baseBranch, cwd)
            // eslint-disable-next-line no-await-in-loop
            await gitCleanFdx(cwd)
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { cwd, spinner })
          }
          if (errored) {
            if (!isCi) {
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await Promise.all([
                removeNodeModules(cwd),
                editablePkgJson.save()
              ])
              // eslint-disable-next-line no-await-in-loop
              actualTree = await install(pkgEnvDetails, { cwd, spinner })
            }
            spinner?.failAndStop(
              `Update failed for ${oldSpec} in ${workspaceName}`,
              error
            )
          }
        }
      }
    }
  }

  spinner?.stop()
}
