import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { isDebug } from '@socketsecurity/registry/lib/debug'
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
import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { getAlertsMapFromPnpmLockfile } from '../../utils/pnpm-lock-yaml'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'
import { runAgentInstall } from '../optimize/run-agent'

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
    rangeStyle,
    spinner,
    test,
    testScript
  }: NormalizedFixOptions
) {
  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })
  if (!lockfile) {
    return
  }

  const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
    consolidate: true,
    include: { existing: true, unfixable: false, upgradable: false },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    return
  }

  spinner?.start()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  // Lazily access constants.ENV[CI].
  const isCi = constants.ENV[CI]
  const isRepo = await isInGitRepo(cwd)

  let actualTree = await getActualTree(cwd)

  for (const { 0: name, 1: infos } of infoByPkg) {
    if (getManifestData(NPM, name)) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }
    const specs = arrayUnique(
      findPackageNodes(actualTree, name).map(n => `${n.name}@${n.version}`)
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
        const node = findPackageNode(actualTree, name, fromVersion)
        if (!node) {
          continue
        }

        const availableVersions = Object.keys(packument.versions)
        const toVersion = findBestPatchVersion(
          node,
          availableVersions,
          vulnerableVersionRange,
          firstPatchedVersionIdentifier
        )
        const targetPackument = toVersion
          ? packument.versions[toVersion]
          : undefined

        if (!(toVersion && targetPackument)) {
          spinner?.fail(`Could not patch ${fromSpec}`)
          continue
        }

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

        const toVersionRange = applyRange(
          oldOverrides?.[overrideKey] ?? fromVersion,
          toVersion,
          rangeStyle
        )
        const toSpec = `${name}@${toVersionRange}`

        const branch = isCi ? getSocketBranchName(fromPurl, toVersion) : ''
        const baseBranch = isCi ? getBaseGitBranch() : ''
        const { owner, repo } = isCi
          ? getGitHubEnvRepoInfo()
          : { owner: '', repo: '' }
        const shouldOpenPr = isCi
          ? // eslint-disable-next-line no-await-in-loop
            !(await doesPullRequestExistForBranch(owner, repo, branch))
          : false

        const updateData = {
          [PNPM]: {
            ...oldPnpm,
            [OVERRIDES]: {
              [overrideKey]: toVersionRange,
              ...oldOverrides
            }
          }
        }

        const revertData = {
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
            : undefined,
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

        if (isCi) {
          // eslint-disable-next-line no-await-in-loop
          await gitCheckoutBaseBranchIfAvailable(baseBranch, cwd)
        }

        let error: unknown
        let errored = false
        let installed = false
        let saved = false
        try {
          editablePkgJson.update(updateData)
          updatePackageJsonFromNode(
            editablePkgJson,
            actualTree,
            node,
            toVersion,
            rangeStyle
          )
          // eslint-disable-next-line no-await-in-loop
          await editablePkgJson.save()
          saved = true

          // eslint-disable-next-line no-await-in-loop
          actualTree = await install(pkgEnvDetails, { spinner })
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
            getSocketCommitMessage(fromPurl, toVersion),
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
            cwd
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
          if (isRepo) {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await getActualTree(cwd)
          } else if (installed) {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })
          }
          if (errored) {
            spinner?.failAndStop(`Failed to fix ${fromSpec}`)
          }
        }
      }
    }
  }
  spinner?.stop()
}
