import path from 'node:path'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog } from '@socketsecurity/registry/lib/debug'
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
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  getAlertsMapFromArborist,
  getAlertsMapFromPurls
} from '../../utils/alerts-map'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updateNode,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { removeNodeModules } from '../../utils/fs'
import { globWorkspace } from '../../utils/glob'
import { applyRange } from '../../utils/semver'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'

import type { NormalizedFixOptions } from './types'
import type { SafeNode } from '../../shadow/npm/arborist/lib/node'
import type { EnvDetails } from '../../utils/package-environment'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const { CI, NPM } = constants

type InstallOptions = {
  cwd?: string | undefined
}

async function install(
  idealTree: SafeNode,
  options: InstallOptions
): Promise<void> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options
  } as InstallOptions
  const arb = new Arborist({ path: cwd })
  arb.idealTree = idealTree
  await arb.reify()
}

export async function npmFix(
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
  const arb = new SafeArborist({
    path: rootPath,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  // Calling arb.reify() creates the arb.diff object and nulls-out arb.idealTree.
  await arb.reify()

  const alertsMap = purls.length
    ? await getAlertsMapFromPurls(purls, alertMapOptions)
    : await getAlertsMapFromArborist(arb, alertMapOptions)

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

      arb.idealTree = null
      // eslint-disable-next-line no-await-in-loop
      await arb.buildIdealTree()

      const oldVersions = arrayUnique(
        findPackageNodes(arb.idealTree!, name)
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

      for (const oldVersion of oldVersions) {
        const oldSpec = `${name}@${oldVersion}`
        const oldPurl = `pkg:npm/${oldSpec}`

        const node = findPackageNode(arb.idealTree!, name, oldVersion)
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

          const newVersionRange = applyRange(oldVersion, newVersion, rangeStyle)
          const newSpec = `${name}@${newVersionRange}`
          const newSpecKey = `${workspaceName}:${newSpec}`

          if (fixedSpecs.has(newSpecKey)) {
            debugLog(`Already fixed ${newSpec} in ${workspaceName}, skipping`)
            continue
          }

          const revertData = {
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

          updateNode(node, newVersion, newVersionPackument)
          updatePackageJsonFromNode(
            editablePkgJson,
            arb.idealTree!,
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
            await install(arb.idealTree!, { cwd })
            if (test) {
              spinner?.info(`Testing ${newSpec} in ${workspaceName}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            fixedSpecs.add(newSpecKey)
            spinner?.successAndStop(`Fixed ${name} in ${workspaceName}`)
            spinner?.start()
          } catch (e) {
            errored = true
            error = e
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
            await install(arb.idealTree!, { cwd })
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
              await install(arb.idealTree!, { cwd })
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
