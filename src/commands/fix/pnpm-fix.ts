import path from 'node:path'

import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
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
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { CI, NPM, OVERRIDES, PNPM } = constants

type InstallOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

async function getActualTree(cwd: string = process.cwd()): Promise<SafeNode> {
  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  return await arb.loadActual()
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
  const { pkgPath: rootPath } = pkgEnvDetails
  const lockfile = await readWantedLockfile(rootPath, {
    ignoreIncompatible: false
  })
  if (!lockfile) {
    return
  }

  const alertMapOptions = {
    consolidate: true,
    include: { existing: true, unfixable: false, upgradable: false },
    nothrow: true
  }

  const alertsMap = purls.length
    ? await getAlertsMapFromPurls(purls, alertMapOptions)
    : await getAlertsMapFromPnpmLockfile(lockfile, alertMapOptions)

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    return
  }

  spinner?.start()

  // Lazily access constants.ENV[CI].
  const isCi = constants.ENV[CI]
  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath
  )

  const baseBranch = isCi ? getBaseGitBranch() : ''

  const { owner, repo } = isCi
    ? getGitHubEnvRepoInfo()
    : { owner: '', repo: '' }

  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!
  ]

  for (const { 0: name, 1: infos } of infoByPkg) {
    debugLog(`Processing vulnerable package: ${name}`)
    if (getManifestData(NPM, name)) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }

    const fixedSpecs = new Set<string>()

    for (const pkgJsonPath of pkgJsonPaths) {
      debugLog(`Checking workspace: ${pkgJsonPath}`)

      // eslint-disable-next-line no-await-in-loop
      let actualTree = await getActualTree(cwd)

      const isWorkspaceRoot =
        pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
      const workspaceName = isWorkspaceRoot
        ? 'root'
        : path.relative(rootPath, path.dirname(pkgJsonPath))

      const editablePkgJson = isWorkspaceRoot
        ? pkgEnvDetails.editablePkgJson
        : // eslint-disable-next-line no-await-in-loop
          await readPackageJson(pkgJsonPath, { editable: true })

      // Get current overrides for revert logic
      const oldPnpmSection = editablePkgJson.content[PNPM] as
        | StringKeyValueObject
        | undefined
      const oldOverrides = oldPnpmSection?.[OVERRIDES] as
        | Record<string, string>
        | undefined

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.target?.version ?? n.version)
          .filter(Boolean)
      )
      const packument =
        oldVersions.length && infos.length
          ? // eslint-disable-next-line no-await-in-loop
            await fetchPackagePackument(name)
          : null
      if (!packument) {
        continue
      }

      for (const oldVersion of oldVersions) {
        const oldSpec = `${name}@${oldVersion}`
        const oldPurl = `pkg:npm/${oldSpec}`

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          debugLog(`Skipping ${oldSpec}, no node found in ${pkgJsonPath}`)
          continue
        }

        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of infos) {
          const availableVersions = Object.keys(packument.versions)
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
            spinner?.fail(`No update available for ${oldSpec}`)
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
          const modded = updatePackageJsonFromNode(
            editablePkgJson,
            actualTree,
            node,
            newVersion,
            rangeStyle
          )
          debugLog(`Updated package.json from node: ${modded}`)

          // eslint-disable-next-line no-await-in-loop
          if (!(await editablePkgJson.save())) {
            debugLog(`No changes saved for ${pkgJsonPath}, skipping install`)
            continue
          }

          spinner?.info(`Installing ${newSpec} in ${workspaceName}`)

          let errored = false
          let error: unknown

          try {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })

            if (test) {
              spinner?.info(`Testing ${newSpec} in ${workspaceName}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }

            fixedSpecs.add(newSpecKey)
            spinner?.successAndStop(`Fixed ${name} in ${workspaceName}`)
            spinner?.start()

            const branch = getSocketBranchName(
              oldPurl,
              newVersion,
              workspaceName
            )
            const shouldOpenPr = isCi
              ? // eslint-disable-next-line no-await-in-loop
                !(await doesPullRequestExistForBranch(owner, repo, branch))
              : false

            if (
              isCi &&
              shouldOpenPr &&
              // eslint-disable-next-line no-await-in-loop
              (await gitCreateAndPushBranchIfNeeded(
                branch,
                getSocketCommitMessage(oldPurl, newVersion, workspaceName),
                cwd
              ))
            ) {
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
                spinner?.info(`PR #${data.number} opened.`)
                if (autoMerge) {
                  // eslint-disable-next-line no-await-in-loop
                  await enableAutoMerge(data)
                }
              }
            }
          } catch (e) {
            error = e
            errored = true
          }

          if (errored) {
            editablePkgJson.update(revertData)
            // eslint-disable-next-line no-await-in-loop
            await Promise.all([removeNodeModules(cwd), editablePkgJson.save()])
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })
            spinner?.failAndStop(
              `Update failed for ${oldSpec} in ${workspaceName}`,
              error
            )
          } else if (isCi) {
            // eslint-disable-next-line no-await-in-loop
            await gitHardReset(baseBranch, cwd)
            // eslint-disable-next-line no-await-in-loop
            await gitCleanFdx(cwd)
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })
          }
        }
      }
    }
  }

  spinner?.stop()
}
