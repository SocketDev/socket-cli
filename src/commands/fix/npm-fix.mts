import { realpathSync } from 'node:fs'
import path from 'node:path'

import NpmConfig from '@npmcli/config'
import {
  definitions as npmConfigDefinitions,
  flatten as npmConfigFlatten,
  shorthands as npmConfigShorthands,
  // @ts-ignore
} from '@npmcli/config/lib/definitions'

import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'

import { agentFix } from './agent-fix.mts'
import { getCiEnv, getOpenPrsForEnvironment } from './fix-env-helpers.mts'
import { getActualTree } from './get-actual-tree.mts'
import { getAlertsMapOptions } from './shared.mts'
import constants from '../../constants.mts'
import {
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
} from '../../shadow/npm/arborist/index.mts'
import { getAlertsMapFromArborist } from '../../shadow/npm/arborist-helpers.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'

import type { FixOptions, InstallOptions } from './agent-fix.mts'
import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
): Promise<NodeClass | null> {
  const { args, cwd, spinner } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  try {
    await runAgentInstall(pkgEnvDetails, {
      args,
      spinner,
      stdio: isDebug() ? 'inherit' : 'ignore',
    })
    return await getActualTree(cwd)
  } catch {}
  return null
}

export async function npmFix(
  pkgEnvDetails: EnvDetails,
  options: FixOptions,
): Promise<CResult<{ fixed: boolean }>> {
  const { limit, purls, spinner } = options

  spinner?.start()

  const ciEnv = await getCiEnv()
  const openPrs = ciEnv ? await getOpenPrsForEnvironment(ciEnv) : []

  let actualTree: NodeClass | undefined
  let alertsMap
  try {
    if (purls.length) {
      alertsMap = await getAlertsMapFromPurls(
        purls,
        getAlertsMapOptions({ limit: Math.max(limit, openPrs.length) }),
      )
    } else {
      const npmPath = path.resolve(
        realpathSync(pkgEnvDetails.agentExecPath),
        '../..',
      )
      const config = new NpmConfig({
        argv: [],
        cwd: process.cwd(),
        definitions: npmConfigDefinitions,
        // Lazily access constants.execPath.
        execPath: constants.execPath,
        env: process.env,
        flatten: npmConfigFlatten,
        npmPath,
        platform: process.platform,
        shorthands: npmConfigShorthands,
      })
      await config.load()
      const arb = new Arborist({
        path: pkgEnvDetails.pkgPath,
        ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        config,
      })
      actualTree = await arb.reify()
      // Calling arb.reify() creates the arb.diff object, nulls-out arb.idealTree,
      // and populates arb.actualTree.
      alertsMap = await getAlertsMapFromArborist(
        arb,
        getAlertsMapOptions({ limit: Math.max(limit, openPrs.length) }),
      )
    }
  } catch (e) {
    spinner?.stop()
    debugFn('catch: PURL API\n', e)
    return {
      ok: false,
      message: 'API Error',
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
      async revertInstall(editablePkgJson) {
        if (revertData) {
          editablePkgJson.update(revertData)
        }
      },
    },
    ciEnv,
    openPrs,
    options,
  )
}
