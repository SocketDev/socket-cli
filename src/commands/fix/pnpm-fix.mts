import { existsSync } from 'node:fs'
import path from 'node:path'

import yaml from 'js-yaml'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { stripBom } from '@socketsecurity/registry/lib/strings'

import {
  getBaseGitBranch,
  getSocketBranchName,
  getSocketCommitMessage,
  gitCreateAndPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles
} from './git.mts'
import {
  cleanupOpenPrs,
  enablePrAutoMerge,
  getGitHubEnvRepoInfo,
  openPr,
  prExistForBranch
} from './open-pr.mts'
import { getAlertMapOptions } from './shared.mts'
import constants from '../../constants.mts'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist/index.mts'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode
} from '../../shadow/npm/arborist-helpers.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls
} from '../../utils/alerts-map.mts'
import { readFileUtf8, removeNodeModules } from '../../utils/fs.mts'
import { globWorkspace } from '../../utils/glob.mts'
import { parsePnpmLockfileVersion } from '../../utils/pnpm.mts'
import { applyRange } from '../../utils/semver.mts'
import { getCveInfoFromAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToPurl } from '../../utils/spec.mts'

import type { NormalizedFixOptions } from './types.mts'
import type { SafeNode } from '../../shadow/npm/arborist/lib/node.mts'
import type { StringKeyValueObject } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { DRY_RUN_NOT_SAVING, NPM, OVERRIDES, PNPM } = constants

async function getActualTree(cwd: string = process.cwd()): Promise<SafeNode> {
  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  return await arb.loadActual()
}

async function readLockfile(
  lockfilePath: string
): Promise<LockfileObject | null> {
  return existsSync(lockfilePath)
    ? (yaml.load(stripBom(await readFileUtf8(lockfilePath))) as LockfileObject)
    : null
}

type InstallOptions = {
  args?: string[] | undefined
  cwd?: string | undefined
  spinner?: Spinner | undefined
}

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions
): Promise<SafeNode> {
  const { args, cwd, spinner } = {
    __proto__: null,
    ...options
  } as InstallOptions
  await runAgentInstall(pkgEnvDetails, {
    args: [
      ...(args ?? []),
      // Enable pnpm updates to pnpm-lock.yaml in CI environments.
      // https://pnpm.io/cli/install#--frozen-lockfile
      '--no-frozen-lockfile',
      // Enable a non-interactive pnpm install
      // https://github.com/pnpm/pnpm/issues/6778
      '--config.confirmModulesPurge=false'
    ],
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
    dryRun,
    limit,
    purls,
    rangeStyle,
    test,
    testScript
  }: NormalizedFixOptions
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
  let lockfile = await readLockfile(lockfilePath)

  // If pnpm-lock.yaml does NOT exist then install with pnpm to create it.
  if (!lockfile) {
    actualTree = await install(pkgEnvDetails, { cwd, spinner })
    lockfile = await readLockfile(lockfilePath)
  }
  // Update pnpm-lock.yaml if its version is older than what the installed pnpm
  // produces.
  if (
    lockfile &&
    pkgEnvDetails.agentVersion.major >= 10 &&
    parsePnpmLockfileVersion(lockfile.lockfileVersion).major <= 6
  ) {
    actualTree = await install(pkgEnvDetails, {
      args: ['--lockfile-only'],
      cwd,
      spinner
    })
    lockfile = await readLockfile(lockfilePath)
  }
  // Exit early if pnpm-lock.yaml is not found.
  if (!lockfile) {
    spinner?.stop()
    logger.error('Required pnpm-lock.yaml not found.')
    return
  }
  const alertsMap = purls.length
    ? await getAlertsMapFromPurls(purls, getAlertMapOptions({ limit }))
    : await getAlertsMapFromPnpmLockfile(
        lockfile,
        getAlertMapOptions({ limit })
      )

  const infoByPkgName = getCveInfoFromAlertsMap(alertsMap, { limit })
  if (!infoByPkgName) {
    spinner?.stop()
    logger.info('No fixable vulnerabilities found.')
    return
  }

  // Lazily access constants.ENV.CI.
  const isCi = constants.ENV.CI
  const baseBranch = isCi ? getBaseGitBranch() : ''
  const workspacePkgJsonPaths = await globWorkspace(
    pkgEnvDetails.agent,
    rootPath
  )
  const pkgJsonPaths = [
    ...workspacePkgJsonPaths,
    // Process the workspace root last since it will add an override to package.json.
    pkgEnvDetails.editablePkgJson.filename!
  ]

  spinner?.stop()

  let count = 0
  const sortedInfoEntries = [...infoByPkgName.entries()].sort((a, b) =>
    naturalCompare(a[0], b[0])
  )
  infoByPkgNameLoop: for (const { 0: name, 1: infos } of sortedInfoEntries) {
    logger.log(`Processing vulnerable package: ${name}`)
    logger.indent()
    spinner?.indent()

    if (getManifestData(NPM, name)) {
      debugLog(`Socket Optimize package exists for ${name}`)
    }
    // eslint-disable-next-line no-await-in-loop
    const packument = await fetchPackagePackument(name)
    if (!packument) {
      logger.warn(`Unexpected condition: No packument found for ${name}\n`)
      logger.dedent()
      spinner?.dedent()
      continue
    }

    const availableVersions = Object.keys(packument.versions)
    const warningsForAfter = new Set<string>()

    for (const pkgJsonPath of pkgJsonPaths) {
      const pkgPath = path.dirname(pkgJsonPath)
      const isWorkspaceRoot =
        pkgJsonPath === pkgEnvDetails.editablePkgJson.filename
      const workspaceName = isWorkspaceRoot
        ? 'root'
        : path.relative(rootPath, pkgPath)

      logger.log(`Checking workspace: ${workspaceName}`)

      // eslint-disable-next-line no-await-in-loop
      actualTree = await install(pkgEnvDetails, { cwd, spinner })

      const oldVersions = arrayUnique(
        findPackageNodes(actualTree, name)
          .map(n => n.version)
          .filter(Boolean)
      )

      if (!oldVersions.length) {
        logger.warn(
          `Unexpected condition: Lockfile entries not found for ${name}.\n`
        )
        if (isDebug()) {
          console.dir(actualTree, { depth: 999 })
        }
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
        const oldId = `${name}@${oldVersion}`
        const oldPurl = idToPurl(oldId)

        const node = findPackageNode(actualTree, name, oldVersion)
        if (!node) {
          logger.warn(
            `Unexpected condition: Arborist node not found, skipping ${oldId}`
          )
          continue
        }
        for (const {
          firstPatchedVersionIdentifier,
          vulnerableVersionRange
        } of infos.values()) {
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
            warningsForAfter.add(
              `No update applied. ${oldId} needs >=${firstPatchedVersionIdentifier}`
            )
            continue
          }

          const overrideKey = `${name}@${vulnerableVersionRange}`
          const newVersionRange = applyRange(
            oldOverrides?.[overrideKey] ?? oldVersion,
            newVersion,
            rangeStyle
          )
          const newId = `${name}@${newVersionRange}`
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
              dependencies: { ...editablePkgJson.content.dependencies }
            }),
            ...(editablePkgJson.content.optionalDependencies && {
              optionalDependencies: {
                ...editablePkgJson.content.optionalDependencies
              }
            }),
            ...(editablePkgJson.content.peerDependencies && {
              peerDependencies: { ...editablePkgJson.content.peerDependencies }
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
          if (!(await editablePkgJson.save({ ignoreWhitespace: true }))) {
            logger.info(`${workspaceName}/package.json not changed, skipping`)
            // Reset things just in case.
            if (isCi) {
              // eslint-disable-next-line no-await-in-loop
              await gitResetAndClean(baseBranch, cwd)
            }
            continue
          }

          spinner?.start()
          spinner?.info(`Installing ${newId} in ${workspaceName}`)

          let error
          let errored = false
          try {
            // eslint-disable-next-line no-await-in-loop
            actualTree = await install(pkgEnvDetails, { cwd, spinner })
            if (test) {
              spinner?.info(`Testing ${newId} in ${workspaceName}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            spinner?.successAndStop(`Fixed ${name} in ${workspaceName}`)
          } catch (e) {
            error = e
            errored = true
            spinner?.stop()
          }

          if (!errored && isCi) {
            const branch = getSocketBranchName(
              oldPurl,
              newVersion,
              workspaceName
            )
            try {
              const { owner, repo } = getGitHubEnvRepoInfo()
              // eslint-disable-next-line no-await-in-loop
              if (await prExistForBranch(owner, repo, branch)) {
                debugLog(`Branch "${branch}" exists, skipping PR creation.`)
                continue
              }
              // eslint-disable-next-line no-await-in-loop
              if (await gitRemoteBranchExists(branch, cwd)) {
                debugLog(
                  `Remote branch "${branch}" exists, skipping PR creation.`
                )
                continue
              }

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
                  'Unexpected condition: Nothing to commit, skipping PR creation.'
                )
                continue
              }

              if (
                // eslint-disable-next-line no-await-in-loop
                !(await gitCreateAndPushBranch(
                  branch,
                  getSocketCommitMessage(oldPurl, newVersion, workspaceName),
                  moddedFilepaths,
                  cwd
                ))
              ) {
                logger.warn(
                  'Unexpected condition: Push failed, skipping PR creation.'
                )
                continue
              }
              // eslint-disable-next-line no-await-in-loop
              await cleanupOpenPrs(owner, repo, oldPurl, newVersion, {
                workspaceName
              })
              // eslint-disable-next-line no-await-in-loop
              const prResponse = await openPr(
                owner,
                repo,
                branch,
                oldPurl,
                newVersion,
                {
                  baseBranch,
                  cwd,
                  workspaceName
                }
              )
              if (prResponse) {
                const { data } = prResponse
                logger.info(`Opened PR #${data.number}.`)
                if (autoMerge) {
                  // eslint-disable-next-line no-await-in-loop
                  await enablePrAutoMerge(data)
                }
              }
            } catch (e) {
              error = e
              errored = true
            }
          }

          if (isCi) {
            // eslint-disable-next-line no-await-in-loop
            await gitResetAndClean(baseBranch, cwd)
          }
          if (errored) {
            if (!isCi) {
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await Promise.all([
                removeNodeModules(cwd),
                editablePkgJson.save({ ignoreWhitespace: true })
              ])
            }
            spinner?.failAndStop(
              `Update failed for ${oldId} in ${workspaceName}`,
              error
            )
          }
          if (++count >= limit) {
            break infoByPkgNameLoop
          }
        }
      }
      logger.log('')
    }

    for (const warningText of warningsForAfter) {
      logger.warn(warningText)
    }
    if (warningsForAfter.size) {
      logger.log('')
    }

    logger.dedent()
    spinner?.dedent()
  }

  spinner?.stop()
}
