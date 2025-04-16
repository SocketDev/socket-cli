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
  gitCheckoutBaseBranchIfAvailable,
  gitCreateAndPushBranchIfNeeded
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

  let actualTree = await getActualTree(cwd)

  for (const { 0: name, 1: infos } of infoByPkg) {
    if (getManifestData(NPM, name)) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }
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

    const failedSpecs = new Set<string>()
    const fixedSpecs = new Set<string>()
    const installedSpecs = new Set<string>()
    const testedSpecs = new Set<string>()
    const unavailableSpecs = new Set<string>()
    const revertedSpecs = new Set<string>()

    for (const pkgJsonPath of pkgJsonPaths) {
      for (const oldVersion of oldVersions) {
        const oldSpec = `${name}@${oldVersion}`
        const oldPurl = `pkg:npm/${oldSpec}`

        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of infos) {
          const node = findPackageNode(actualTree, name, oldVersion)
          if (!node) {
            debugLog(
              `Skipping ${oldSpec}, no node found in arborist.actualTree`,
              pkgJsonPath
            )
            continue
          }

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
            if (!unavailableSpecs.has(oldSpec)) {
              unavailableSpecs.add(oldSpec)
              spinner?.fail(`No update available for ${oldSpec}`)
            }
            continue
          }

          const isWorkspaceRoot =
            pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
          const workspaceName = isWorkspaceRoot
            ? ''
            : path.relative(rootPath, path.dirname(pkgJsonPath))
          const workspaceDetails = workspaceName ? ` in ${workspaceName}` : ''
          const editablePkgJson = isWorkspaceRoot
            ? pkgEnvDetails.editablePkgJson
            : // eslint-disable-next-line no-await-in-loop
              await readPackageJson(pkgJsonPath, { editable: true })

          const oldPnpm = editablePkgJson.content[PNPM] as
            | StringKeyValueObject
            | undefined
          const oldPnpmKeyCount = oldPnpm ? Object.keys(oldPnpm).length : 0
          const oldOverrides = (oldPnpm as StringKeyValueObject)?.[OVERRIDES] as
            | Record<string, string>
            | undefined
          const oldOverridesCount = oldOverrides
            ? Object.keys(oldOverrides).length
            : 0

          const overrideKey = `${name}@${vulnerableVersionRange}`
          const newVersionRange = applyRange(
            oldOverrides?.[overrideKey] ?? oldVersion,
            newVersion,
            rangeStyle
          )
          const newSpec = `${name}@${newVersionRange}`
          const newSpecKey = `${workspaceName ? `${workspaceName}>` : ''}${newSpec}`

          const updateData = isWorkspaceRoot
            ? {
                [PNPM]: {
                  ...oldPnpm,
                  [OVERRIDES]: {
                    [overrideKey]: newVersionRange,
                    ...oldOverrides
                  }
                }
              }
            : undefined

          const revertData = {
            ...(isWorkspaceRoot
              ? {
                  [PNPM]: oldPnpmKeyCount
                    ? {
                        ...oldPnpm,
                        [OVERRIDES]:
                          oldOverridesCount === 1
                            ? undefined
                            : {
                                [overrideKey]: undefined,
                                ...oldOverrides
                              }
                      }
                    : undefined
                }
              : {}),
            ...(editablePkgJson.content.dependencies
              ? { dependencies: editablePkgJson.content.dependencies }
              : undefined),
            ...(editablePkgJson.content.optionalDependencies
              ? {
                  optionalDependencies:
                    editablePkgJson.content.optionalDependencies
                }
              : undefined),
            ...(editablePkgJson.content.peerDependencies
              ? { peerDependencies: editablePkgJson.content.peerDependencies }
              : undefined)
          } as PackageJson

          const branch = isCi
            ? getSocketBranchName(oldPurl, newVersion, workspaceName)
            : ''
          const shouldOpenPr = isCi
            ? // eslint-disable-next-line no-await-in-loop
              !(await doesPullRequestExistForBranch(owner, repo, branch))
            : false

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

          let error: unknown
          let errored = false
          let installed = false

          // eslint-disable-next-line no-await-in-loop
          if (!(await editablePkgJson.save())) {
            debugLog(`Skipping nothing changed in ${editablePkgJson.filename}`)
            continue
          }

          if (!installedSpecs.has(newSpecKey)) {
            installedSpecs.add(newSpecKey)
            spinner?.info(`Installing ${newSpec}${workspaceDetails}`)
          }

          try {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })
            installed = true

            if (test) {
              if (!testedSpecs.has(newSpecKey)) {
                testedSpecs.add(newSpecKey)
                spinner?.info(`Testing ${newSpec}${workspaceDetails}`)
              }
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            if (!fixedSpecs.has(newSpecKey)) {
              fixedSpecs.add(newSpecKey)
              spinner?.successAndStop(`Fixed ${name}${workspaceDetails}`)
              spinner?.start()
            }
          } catch (e) {
            error = e
            errored = true
          }

          if (
            !errored &&
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

          if (errored || isCi) {
            if (errored) {
              if (!revertedSpecs.has(newSpecKey)) {
                revertedSpecs.add(newSpecKey)
                spinner?.error(`Reverting ${newSpec}${workspaceDetails}`, error)
              }
            }

            editablePkgJson.update(revertData)
            // eslint-disable-next-line no-await-in-loop
            await Promise.all([
              removeNodeModules(cwd),
              ...(isCi
                ? [gitCheckoutBaseBranchIfAvailable(baseBranch, cwd)]
                : []),
              ...(installed && !isCi ? [editablePkgJson.save()] : [])
            ])
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })

            if (errored) {
              if (!failedSpecs.has(newSpecKey)) {
                failedSpecs.add(newSpecKey)
                spinner?.failAndStop(
                  `Update failed for ${oldSpec}${workspaceDetails}`
                )
              }
            }
          }
        }
      }
    }
  }
  spinner?.stop()
}
