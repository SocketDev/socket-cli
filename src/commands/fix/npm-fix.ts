import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import {
  checkoutBaseBranchIfAvailable,
  getBaseBranch,
  getSocketBranchName
} from './git'
import {
  doesPullRequestExistForBranch,
  enableAutoMerge,
  getGitHubRepoInfo,
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
  findPackageNode,
  findPackageNodes,
  getAlertsMapFromArborist,
  updateNode,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
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
  _pkgEnvDetails: EnvDetails,
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
    path: cwd,
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

  const editablePkgJson = await readPackageJson(cwd, { editable: true })

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
      const oldVersion = spec.slice(lastAtSignIndex + 1)
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
          continue
        }

        const oldSpec = `${name}@${oldVersion}`
        if (
          !updateNode(
            node,
            packument,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier
          )
        ) {
          spinner?.failAndStop(`Could not patch ${oldSpec}`)
          return
        }

        const targetVersion = node.package.version!
        const fixSpec = `${name}@^${targetVersion}`
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

        spinner?.info(`Installing ${fixSpec}`)

        const { owner, repo } = getGitHubRepoInfo()
        const baseBranch = getBaseBranch()
        const branch = getSocketBranchName(name, targetVersion)

        // eslint-disable-next-line no-await-in-loop
        await checkoutBaseBranchIfAvailable(baseBranch, cwd)

        let installed = false
        let saved = false
        try {
          updatePackageJsonFromNode(
            editablePkgJson,
            arb.idealTree!,
            node,
            targetVersion,
            rangeStyle
          )
          // eslint-disable-next-line no-await-in-loop
          await editablePkgJson.save()
          saved = true

          // eslint-disable-next-line no-await-in-loop
          await install(arb.idealTree!, { cwd })
          installed = true

          if (test) {
            spinner?.info(`Testing ${fixSpec}`)
            // eslint-disable-next-line no-await-in-loop
            await runScript(testScript, [], { spinner, stdio: 'ignore' })
          }
          spinner?.successAndStop(`Fixed ${name}`)
          spinner?.start()
        } catch {
          spinner?.error(`Reverting ${fixSpec}`)
          if (saved) {
            editablePkgJson.update(revertData)
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
          }
          if (installed) {
            // eslint-disable-next-line no-await-in-loop
            await install(revertTree, { cwd })
          }
          spinner?.failAndStop(`Failed to fix ${oldSpec}`)
          return
        }

        if (
          // Lazily access constants.ENV[CI].
          constants.ENV[CI] &&
          // eslint-disable-next-line no-await-in-loop
          !(await doesPullRequestExistForBranch(owner, repo, branch))
        ) {
          let prResponse
          try {
            // eslint-disable-next-line no-await-in-loop
            prResponse = await openGitHubPullRequest(
              owner,
              repo,
              baseBranch,
              branch,
              name,
              targetVersion,
              cwd
            )
          } catch (e) {
            logger.error('Failed to open pull request', e)
          }
          if (prResponse && autoMerge) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await enableAutoMerge(prResponse.data)
            } catch (e) {
              logger.error('Failed to enable auto-merge in pull request', e)
            }
          }
        }
      }
    }
  }
  spinner?.stop()
}
