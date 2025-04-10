import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import { enableAutoMerge, openGitHubPullRequest } from './open-pr'
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
      const oldVersion = spec.slice(lastAtSignIndex + 1)
      for (const {
        firstPatchedVersionIdentifier,
        vulnerableVersionRange
      } of infos) {
        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          continue
        }
        const oldSpec = `${name}@${oldVersion}`
        const availableVersions = Object.keys(packument.versions)
        const targetVersion = findBestPatchVersion(
          node,
          availableVersions,
          vulnerableVersionRange,
          firstPatchedVersionIdentifier
        )
        const targetPackument = targetVersion
          ? packument.versions[targetVersion]
          : undefined
        let failed = false
        let installed = false
        let saved = false
        if (targetVersion && targetPackument) {
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
          const overrideKey = `${node.name}@${vulnerableVersionRange}`
          const overrideRange = applyRange(
            oldOverrides?.[overrideKey] ?? targetVersion,
            targetVersion,
            rangeStyle
          )
          const fixSpec = `${name}@${overrideRange}`
          const updateData = {
            [PNPM]: {
              ...oldPnpm,
              [OVERRIDES]: {
                [overrideKey]: overrideRange,
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

          spinner?.info(`Installing ${fixSpec}`)

          try {
            editablePkgJson.update(updateData)
            updatePackageJsonFromNode(
              editablePkgJson,
              actualTree,
              node,
              targetVersion,
              rangeStyle
            )
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            saved = true

            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { spinner })
            installed = true

            if (test) {
              spinner?.info(`Testing ${fixSpec}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }

            spinner?.successAndStop(`Fixed ${name}`)
            spinner?.start()
          } catch (e) {
            failed = true
            spinner?.error(`Reverting ${fixSpec}`, e)
            if (saved) {
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await editablePkgJson.save()
            }
            if (installed) {
              // eslint-disable-next-line no-await-in-loop
              actualTree = await install(pkgEnvDetails, { spinner })
            }
            spinner?.failAndStop(`Failed to fix ${oldSpec}`)
          }
        } else {
          failed = true
          spinner?.failAndStop(`Could not patch ${oldSpec}`)
        }
        if (
          !failed &&
          // Check targetVersion to make TypeScript happy.
          targetVersion &&
          // Lazily access constants.ENV[CI].
          constants.ENV[CI]
        ) {
          let prResponse
          try {
            // eslint-disable-next-line no-await-in-loop
            prResponse = await openGitHubPullRequest(name, targetVersion, cwd)
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
