import { promises as fs } from 'node:fs'

import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { hasKeys } from '@socketsecurity/registry/lib/objects'

import { agentFix } from './agent-fix.mts'
import { getActualTree } from './get-actual-tree.mts'
import { getFixAlertsMapOptions } from './shared.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../utils/alerts-map.mts'
import { readLockfile } from '../../utils/lockfile.mts'
import {
  extractOverridesFromPnpmLockSrc,
  parsePnpmLockfile,
  parsePnpmLockfileVersion,
} from '../../utils/pnpm.mts'
import { applyRange } from '../../utils/semver.mts'
import { getOverridesDataPnpm } from '../optimize/get-overrides-by-agent.mts'

import type {
  ActualTreeResult,
  FixConfig,
  InstallOptions,
} from './agent-fix.mts'
import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult, StringKeyValueObject } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
): Promise<ActualTreeResult> {
  const {
    args: extraArgs,
    cwd,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  const args = [
    // Do not execute any scripts defined in the project package.json and its dependencies.
    // https://pnpm.io/9.x/cli/install#--ignore-scripts
    '--ignore-scripts',
    // Enable pnpm updates to pnpm-lock.yaml in CI environments.
    // https://pnpm.io/cli/install#--frozen-lockfile
    '--no-frozen-lockfile',
    // Enable a non-interactive pnpm install
    // https://github.com/pnpm/pnpm/issues/6778
    '--config.confirmModulesPurge=false',
    ...(extraArgs ?? []),
  ]

  const wasSpinning = !!spinner?.isSpinning

  spinner?.stop()

  const quotedCmd = `\`${pkgEnvDetails.agent} install ${args.join(' ')}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await runAgentInstall(pkgEnvDetails, {
      args,
      spinner,
      stdio: isDebug('stdio') ? 'inherit' : 'ignore',
    })
  } catch (error) {
    const result = { error }
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', result)
    return result
  }

  const treeResult = await getActualTree(cwd)
  if (treeResult.actualTree) {
    if (wasSpinning) {
      spinner.start()
    }
    return treeResult
  }

  debugFn('error', 'caught: await arb.loadActual() error')
  debugDir('inspect', treeResult)

  if (wasSpinning) {
    spinner.start()
  }
  return treeResult
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { cwd, purls, spinner } = fixConfig

  spinner?.start()

  let actualTree: NodeClass | undefined
  let lockSrc: string = pkgEnvDetails.lockSrc
  let lockfile = parsePnpmLockfile(lockSrc)
  // Update pnpm-lock.yaml if its version is older than what the installed pnpm
  // produces.
  if (
    pkgEnvDetails.agentVersion.major >= 10 &&
    (parsePnpmLockfileVersion(lockfile?.lockfileVersion)?.major ?? 0) <= 6
  ) {
    const installResult = await install(pkgEnvDetails, {
      args: ['--lockfile-only'],
      cwd,
      spinner,
    })
    const maybeActualTree = installResult.actualTree
    if (maybeActualTree) {
      lockSrc = (await readLockfile(pkgEnvDetails.lockPath)) ?? ''
    } else {
      lockSrc = ''
    }
    if (lockSrc) {
      actualTree = maybeActualTree!
      lockfile = parsePnpmLockfile(lockSrc)
    } else {
      lockfile = null
    }
  }

  // Exit early if pnpm-lock.yaml is not found or usable.
  // Check !lockSrc to make TypeScript happy.
  if (!lockfile || !lockSrc) {
    spinner?.stop()
    return {
      ok: false,
      message: 'Missing lockfile',
      cause: 'Required pnpm-lock.yaml not found or usable',
    }
  }

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(purls, getFixAlertsMapOptions())
      : await getAlertsMapFromPnpmLockfile(lockfile, getFixAlertsMapOptions())
  } catch (e) {
    spinner?.stop()
    debugFn('error', 'caught: Socket batch PURL API error')
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: 'Socket API error',
      cause: (e as Error)?.message || 'Unknown Socket batch PURL API error.',
    }
  }

  let revertData: PackageJson | undefined
  let revertOverrides: PackageJson | undefined
  let revertOverridesSrc = ''

  return await agentFix(
    pkgEnvDetails,
    actualTree,
    alertsMap,
    install,
    {
      async beforeInstall(
        editablePkgJson,
        packument,
        oldVersion,
        newVersion,
        vulnerableVersionRange,
        options,
      ) {
        lockSrc = (await readLockfile(pkgEnvDetails.lockPath)) ?? ''

        // Update overrides for the root workspace.
        if (
          editablePkgJson.filename === pkgEnvDetails.editablePkgJson.filename
        ) {
          const { overrides: oldOverrides } = getOverridesDataPnpm(
            pkgEnvDetails,
            editablePkgJson.content,
          )
          const oldPnpmSection = editablePkgJson.content['pnpm'] as
            | StringKeyValueObject
            | undefined
          const overrideKey = `${packument.name}@${vulnerableVersionRange}`

          revertOverridesSrc = extractOverridesFromPnpmLockSrc(lockSrc)
          // Track existing overrides in the root package.json to revert to later.
          revertOverrides = {
            pnpm: oldPnpmSection
              ? {
                  ...oldPnpmSection,
                  overrides: hasKeys(oldOverrides)
                    ? {
                        ...oldOverrides,
                        [overrideKey]: undefined,
                      }
                    : // Properties with undefined values are deleted when saved as JSON.
                      undefined,
                }
              : // Properties with undefined values are deleted when saved as JSON.
                undefined,
          } as PackageJson
          // Update overrides in the root package.json so that when `pnpm install`
          // generates pnpm-lock.yaml it updates transitive dependencies too.
          editablePkgJson.update({
            pnpm: {
              ...oldPnpmSection,
              overrides: {
                ...oldOverrides,
                [overrideKey]: applyRange(
                  oldOverrides?.[overrideKey] ?? oldVersion,
                  newVersion,
                  options.rangeStyle,
                ),
              },
            },
          })
        } else {
          revertOverrides = undefined
          revertOverridesSrc = ''
        }
        revertData = {
          // If "pnpm" or "pnpm.overrides" fields are undefined they will be
          // deleted when saved.
          ...revertOverrides,
          // Track existing dependencies in the root package.json to revert to later.
          ...(editablePkgJson.content.dependencies && {
            dependencies: { ...editablePkgJson.content.dependencies },
          }),
          ...(editablePkgJson.content.optionalDependencies && {
            optionalDependencies: {
              ...editablePkgJson.content.optionalDependencies,
            },
          }),
          ...(editablePkgJson.content.peerDependencies && {
            peerDependencies: { ...editablePkgJson.content.peerDependencies },
          }),
        } as PackageJson
      },
      async afterInstall(editablePkgJson) {
        if (revertOverrides) {
          // Revert overrides metadata in package.json now that pnpm-lock.yaml
          // has been updated.
          editablePkgJson.update(revertOverrides)
          await editablePkgJson.save({ ignoreWhitespace: true })
        }
        lockSrc = (await readLockfile(pkgEnvDetails.lockPath)) ?? ''
        // Remove "overrides" block from pnpm-lock.yaml lockfile when processing
        // the root workspace.
        if (
          editablePkgJson.filename === pkgEnvDetails.editablePkgJson.filename
        ) {
          const updatedOverridesContent =
            extractOverridesFromPnpmLockSrc(lockSrc)
          if (updatedOverridesContent) {
            // Remove "overrides" block from pnpm-lock.yaml lockfile.
            lockSrc = lockSrc!.replace(
              updatedOverridesContent,
              revertOverridesSrc,
            )
            // Save pnpm-lock.yaml lockfile.
            await fs.writeFile(pkgEnvDetails.lockPath, lockSrc, 'utf8')
          }
        }
      },
      async revertInstall(editablePkgJson) {
        if (revertData) {
          // Revert package.json.
          editablePkgJson.update(revertData)
          await editablePkgJson.save({ ignoreWhitespace: true })
          // Revert pnpm-lock.yaml lockfile to be on the safe side.
          await fs.writeFile(pkgEnvDetails.lockPath, lockSrc, 'utf8')
        }
      },
    },
    fixConfig,
  )
}
