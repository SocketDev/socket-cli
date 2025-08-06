import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'

import { agentFix } from './agent-fix.mts'
import { getActualTree } from './get-actual-tree.mts'
import { getFixAlertsMapOptions } from './shared.mts'
import { Arborist } from '../../shadow/npm/arborist/index.mts'
import { SAFE_WITH_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES } from '../../shadow/npm/arborist/lib/arborist/index.mts'
import {
  findPackageNode,
  getAlertsMapFromArborist,
  updateNode,
} from '../../shadow/npm/arborist-helpers.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { getNpmConfig } from '../../utils/npm-config.mts'

import type {
  ActualTreeResult,
  FixConfig,
  InstallOptions,
} from './agent-fix.mts'
import type {
  ArboristInstance,
  NodeClass,
} from '../../shadow/npm/arborist/types.mts'
import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { AlertsByPurl } from '../../utils/socket-package-alert.mts'
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
  const useDebug = isDebug('stdio')
  const args = [
    // If "true", npm does not run scripts specified in package.json files.
    // Note that commands explicitly intended to run a particular script, such
    // as `npm start`, `npm stop`, `npm restart`, `npm test`, and `npm run` will
    // still run their intended script if `ignore-scripts` is set, but they will
    // not run any pre- or post-scripts.
    // https://docs.npmjs.com/cli/v11/commands/npm-install#ignore-scripts
    '--ignore-scripts',
    // When "true" submit audit reports alongside the current npm command to the
    // default registry and all registries configured for scopes. See the
    // documentation for `npm audit` for details on what is submitted.
    // https://docs.npmjs.com/cli/v11/commands/npm-install#audit
    '--no-audit',
    // When "true" displays the message at the end of each `npm install` acknowledging
    // the number of dependencies looking for funding. See `npm fund` for details.
    // https://docs.npmjs.com/cli/v11/commands/npm-install#fund
    '--no-fund',
    // When set to "true", npm will display a progress bar during time intensive
    // operations, if `process.stderr` is a TTY. Set to "false" to suppress the
    // progress bar.
    // https://docs.npmjs.com/cli/v8/using-npm/config#progress
    '--no-progress',
    // What level of logs to report. All logs are written to a debug log, with
    // the path to that file printed if the execution of a command fails. The
    // default is "notice".
    // https://docs.npmjs.com/cli/v8/using-npm/config#loglevel
    ...(useDebug ? [] : ['--silent']),
    ...(extraArgs ?? []),
  ]

  const isSpinning = spinner?.isSpinning
  spinner?.stop()

  const quotedCmd = `\`${pkgEnvDetails.agent} install ${args.join(' ')}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await runAgentInstall(pkgEnvDetails, {
      args,
      spinner,
      stdio: useDebug ? 'inherit' : 'ignore',
    })
  } catch (error) {
    const result = { error }
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', result)
    return result
  }

  const treeResult = await getActualTree(cwd)
  if (treeResult.actualTree) {
    if (isSpinning) {
      spinner.start()
    }
    return treeResult
  }
  debugFn('error', 'caught: await arb.loadActual() error')
  debugDir('inspect', treeResult)
  if (isSpinning) {
    spinner.start()
  }
  return treeResult
}

export async function npmFix(
  pkgEnvDetails: EnvDetails,
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { purls, spinner } = fixConfig

  spinner?.start()

  const flatConfig = await getNpmConfig({
    npmVersion: pkgEnvDetails.agentVersion,
  })

  let actualTree: NodeClass | undefined
  let alertsMap: AlertsByPurl | undefined
  try {
    if (purls.length) {
      alertsMap = await getAlertsMapFromPurls(purls, getFixAlertsMapOptions())
    } else {
      let arb: ArboristInstance | undefined
      try {
        arb = new Arborist({
          path: pkgEnvDetails.pkgPath,
          ...flatConfig,
          ...SAFE_WITH_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        })
        // Calling arb.reify() creates the arb.diff object, nulls-out arb.idealTree,
        // and populates arb.actualTree.
        actualTree = await arb.reify()
      } catch (e) {
        spinner?.stop()
        debugFn('error', 'caught: await arb.reify() error')
        debugDir('inspect', { error: e })
        return {
          ok: false,
          message: 'npm error',
          cause: (e as Error)?.message || 'Unknown npm error.',
        }
      }
      alertsMap = await getAlertsMapFromArborist(arb, getFixAlertsMapOptions())
    }
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

  return await agentFix(
    pkgEnvDetails,
    actualTree,
    alertsMap,
    install,
    {
      async beforeInstall(editablePkgJson) {
        revertData = {
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
      async afterUpdate(editablePkgJson, packument, oldVersion, newVersion) {
        // Exit early if not the root workspace.
        if (
          editablePkgJson.filename !== pkgEnvDetails.editablePkgJson.filename
        ) {
          return
        }
        // Update package-lock.json using @npmcli/arborist.
        const arb = new Arborist({
          path: pkgEnvDetails.pkgPath,
          ...flatConfig,
          ...SAFE_WITH_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        })
        // Build the ideal tree of nodes that are used to generated the saved
        // package-lock.json
        const idealTree = await arb.buildIdealTree()
        const node = findPackageNode(idealTree, packument.name, oldVersion)
        if (node) {
          // Update the ideal tree node.
          updateNode(node, newVersion, packument.versions[newVersion]!)
          // Save package-lock.json lockfile.
          await arb.reify()
        }
      },
      async revertInstall(editablePkgJson) {
        if (revertData) {
          // Revert package.json.
          editablePkgJson.update(revertData)
          await editablePkgJson.save({ ignoreWhitespace: true })
        }
      },
    },
    fixConfig,
  )
}
