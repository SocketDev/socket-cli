import path from 'node:path'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog } from '@socketsecurity/registry/lib/debug'
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
  gitCreateAndPushBranchIfNeeded,
  gitHardReset,
  isInGitRepo
} from './git'
import {
  doesPullRequestExistForBranch,
  enableAutoMerge,
  getGitHubEnvRepoInfo,
  openGitHubPullRequest
} from './open-pr'
import { NormalizedFixOptions } from './types'
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
  findPackageNode,
  findPackageNodes,
  updateNode,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { removeNodeModules } from '../../utils/fs'
import { globWorkspace } from '../../utils/glob'
import { applyRange } from '../../utils/semver'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'

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
  const arb2 = new Arborist({ path: cwd })
  arb2.idealTree = idealTree
  await arb2.reify()
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
  const { pkgPath: rootPath } = pkgEnvDetails

  spinner?.start()

  const arb = new SafeArborist({
    path: rootPath,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  // Calling arb.reify() creates the arb.diff object and nulls-out arb.idealTree.
  await arb.reify()

  const alertMapOptions = {
    consolidate: true,
    include: {
      existing: true,
      unfixable: false,
      upgradable: false
    },
    nothrow: true
  }

  const alertsMap = purls.length
    ? await getAlertsMapFromPurls(purls, alertMapOptions)
    : await getAlertsMapFromArborist(arb, alertMapOptions)

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    spinner?.stop()
    return
  }

  // Lazily access constants.ENV[CI].
  const isCi = constants.ENV[CI]

  const { 0: isRepo, 1: workspacePkgJsonPaths } = await Promise.all([
    isInGitRepo(cwd),
    globWorkspace(pkgEnvDetails.agent, rootPath)
  ])

  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!
  ]

  for (const { 0: name, 1: infos } of infoByPkg) {
    const hasUpgrade = !!getManifestData(NPM, name)
    if (hasUpgrade) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }

    arb.idealTree = null
    // eslint-disable-next-line no-await-in-loop
    await arb.buildIdealTree()

    const oldVersions = arrayUnique(
      findPackageNodes(arb.idealTree!, name)
        .map(n => n.version)
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
          const revertTree = arb.idealTree!
          arb.idealTree = null
          // eslint-disable-next-line no-await-in-loop
          await arb.buildIdealTree()

          const node = findPackageNode(arb.idealTree!, name, oldVersion)
          if (!node) {
            debugLog(
              `Skipping ${oldSpec}, no node found in arborist.idealTree`,
              pkgJsonPath
            )
            continue
          }

          if (
            !updateNode(
              node,
              packument,
              vulnerableVersionRange,
              firstPatchedVersionIdentifier
            )
          ) {
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

          const newVersion = node.package.version!
          const newVersionRange = applyRange(oldVersion, newVersion, rangeStyle)
          const newSpec = `${name}@${newVersionRange}`
          const newSpecKey = `${workspaceName ? `${workspaceName}>` : ''}${newSpec}`

          const revertData = {
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
          const baseBranch = isCi ? getBaseGitBranch() : ''
          const { owner, repo } = isCi
            ? getGitHubEnvRepoInfo()
            : { owner: '', repo: '' }
          const shouldOpenPr = isCi
            ? // eslint-disable-next-line no-await-in-loop
              !(await doesPullRequestExistForBranch(owner, repo, branch))
            : false

          if (isCi) {
            // eslint-disable-next-line no-await-in-loop
            await gitCheckoutBaseBranchIfAvailable(baseBranch, cwd)
          }

          updatePackageJsonFromNode(
            editablePkgJson,
            arb.idealTree!,
            node,
            newVersion,
            rangeStyle
          )

          let error: unknown
          let errored = false
          let installed = false
          let saved = false

          // eslint-disable-next-line no-await-in-loop
          if (await editablePkgJson.save()) {
            saved = true
          }

          if (!installedSpecs.has(newSpecKey)) {
            testedSpecs.add(newSpecKey)
            spinner?.info(`Installing ${newSpec}${workspaceDetails}`)
          }

          try {
            // eslint-disable-next-line no-await-in-loop
            await install(arb.idealTree!, { cwd })
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
            if (saved) {
              editablePkgJson.update(revertData)
            }
            // eslint-disable-next-line no-await-in-loop
            await Promise.all([
              removeNodeModules(cwd),
              ...(isRepo ? [gitHardReset(cwd)] : []),
              ...(saved && !isRepo ? [editablePkgJson.save()] : [])
            ])
            if (!isRepo && installed) {
              // eslint-disable-next-line no-await-in-loop
              await install(revertTree, { cwd })
            }
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
