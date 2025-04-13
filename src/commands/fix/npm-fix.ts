import path from 'node:path'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
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
import { applyRange } from './shared'
import { NormalizedFixOptions } from './types'
import constants from '../../constants'
import {
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findPackageNode,
  findPackageNodes,
  getAlertsMapFromArborist,
  updateNode,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { globWorkspace } from '../../utils/glob'
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
    rangeStyle,
    spinner,
    test,
    testScript
  }: NormalizedFixOptions
) {
  spinner?.start()

  const arb = new SafeArborist({
    path: pkgEnvDetails.pkgPath,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  // Calling arb.reify() creates the arb.diff object and nulls-out arb.idealTree.
  await arb.reify()

  const alertsMap = await getAlertsMapFromArborist(arb, {
    consolidate: true,
    include: {
      existing: true,
      unfixable: false,
      upgradable: false
    },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    spinner?.stop()
    return
  }

  // Lazily access constants.ENV[CI].
  const isCi = constants.ENV[CI]
  const { pkgPath: rootPath } = pkgEnvDetails

  const { 0: isRepo, 1: workspacePkgJsonPaths } = await Promise.all([
    isInGitRepo(cwd),
    globWorkspace(pkgEnvDetails)
  ])
  const pkgJsonPaths = [
    pkgEnvDetails.editablePkgJson.filename!,
    ...workspacePkgJsonPaths
  ]

  await arb.buildIdealTree()

  for (const { 0: name, 1: infos } of infoByPkg) {
    const hasUpgrade = !!getManifestData(NPM, name)
    if (hasUpgrade) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }
    const specs = arrayUnique(
      findPackageNodes(arb.idealTree!, name).map(n => `${n.name}@${n.version}`)
    )
    const packument =
      specs.length && infos.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (!packument) {
      continue
    }

    for (const spec of specs) {
      const lastAtSignIndex = spec.lastIndexOf('@')
      const name = spec.slice(0, lastAtSignIndex)
      const fromVersion = spec.slice(lastAtSignIndex + 1)
      const fromSpec = `${name}@${fromVersion}`
      const fromPurl = `pkg:npm/${fromSpec}`
      for (const {
        firstPatchedVersionIdentifier,
        vulnerableVersionRange
      } of infos) {
        const revertTree = arb.idealTree!
        arb.idealTree = null
        // eslint-disable-next-line no-await-in-loop
        await arb.buildIdealTree()
        const node = findPackageNode(arb.idealTree!, name, fromVersion)
        if (!node) {
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
          spinner?.fail(`Could not patch ${fromSpec}`)
          continue
        }

        for (const pkgJsonPath of pkgJsonPaths) {
          const isWorkspaceRoot =
            pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
          const workspaceName = isWorkspaceRoot
            ? ''
            : path.relative(rootPath, path.dirname(pkgJsonPath))
          const editablePkgJson = isWorkspaceRoot
            ? pkgEnvDetails.editablePkgJson
            : // eslint-disable-next-line no-await-in-loop
              await readPackageJson(pkgJsonPath, { editable: true })

          const toVersion = node.package.version!
          const toVersionRange = applyRange(fromVersion, toVersion, rangeStyle)
          const toSpec = `${name}@${toVersionRange}`

          const branch = isCi
            ? getSocketBranchName(fromPurl, toVersion, workspaceName)
            : ''
          const { owner, repo } = isCi
            ? getGitHubEnvRepoInfo()
            : { owner: '', repo: '' }
          const shouldOpenPr = isCi
            ? // eslint-disable-next-line no-await-in-loop
              !(await doesPullRequestExistForBranch(owner, repo, branch))
            : false

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

          spinner?.info(`Installing ${toSpec}`)

          const baseBranch = getBaseGitBranch()

          // eslint-disable-next-line no-await-in-loop
          await gitCheckoutBaseBranchIfAvailable(baseBranch, cwd)

          let error: unknown
          let errored = false
          let installed = false
          let saved = false
          try {
            updatePackageJsonFromNode(
              editablePkgJson,
              arb.idealTree!,
              node,
              toVersion,
              rangeStyle
            )
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            saved = true

            // eslint-disable-next-line no-await-in-loop
            await install(arb.idealTree!, { cwd })
            installed = true

            if (test) {
              spinner?.info(`Testing ${toSpec}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            spinner?.successAndStop(`Fixed ${name}`)
            spinner?.start()
          } catch (e) {
            error = e
            errored = true
          }

          if (!errored && shouldOpenPr) {
            // eslint-disable-next-line no-await-in-loop
            await gitCreateAndPushBranchIfNeeded(
              branch!,
              getSocketCommitMessage(fromPurl, toVersion, workspaceName),
              cwd
            )
            // eslint-disable-next-line no-await-in-loop
            const prResponse = await openGitHubPullRequest(
              owner,
              repo,
              baseBranch,
              branch,
              fromPurl,
              toVersion,
              {
                cwd,
                workspaceName
              }
            )
            if (prResponse && autoMerge) {
              // eslint-disable-next-line no-await-in-loop
              await enableAutoMerge(prResponse.data)
            }
          }

          if (errored || isCi) {
            if (errored) {
              spinner?.error(`Reverting ${toSpec}`, error)
            }
            if (isRepo) {
              // eslint-disable-next-line no-await-in-loop
              await gitHardReset(cwd)
            }
            if (saved) {
              editablePkgJson.update(revertData)
              if (!isRepo) {
                // eslint-disable-next-line no-await-in-loop
                await editablePkgJson.save()
              }
            }
            if (!isRepo && installed) {
              // eslint-disable-next-line no-await-in-loop
              await install(revertTree, { cwd })
            }
            if (errored) {
              spinner?.failAndStop(`Failed to fix ${fromSpec}`)
            }
          }
        }
      }
    }
  }
  spinner?.stop()
}
