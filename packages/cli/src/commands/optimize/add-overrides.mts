import path from 'node:path'

import semver from 'semver'

import { NPM, PNPM } from '@socketsecurity/lib-stable/constants/agents'
import { hasOwn } from '@socketsecurity/lib-stable/objects/predicates'
import { toSortedObject } from '@socketsecurity/lib-stable/objects/sort'
import { fetchPackageManifest } from '@socketsecurity/lib-stable/packages/manifest'
import { pEach } from '@socketsecurity/lib-stable/promises/iterate'
import { getManifestData } from '@socketsecurity/registry-stable'

import { lsStdoutIncludes } from './deps-includes-by-agent.mts'
import { getDependencyEntries } from './get-dependency-entries.mts'
import {
  getOverridesData,
  getOverridesDataNpm,
  getOverridesDataYarnClassic,
} from './get-overrides-by-agent.mts'
import { lockSrcIncludes } from './lockfile-includes-by-agent.mts'
import { listPackages } from './ls-by-agent.mts'
import { CMD_NAME } from './shared.mts'
import { updateManifest } from './update-manifest-by-agent.mts'
import { globWorkspace } from '../../util/fs/glob.mts'
import { safeNpa } from '../../util/npm/package-arg.mts'
import { cmdPrefixMessage } from '../../util/process/cmd.mts'
import { getMajor } from '../../util/semver.mts'

import type { GetOverridesResult } from './get-overrides-by-agent.mts'
import type { EnvDetails } from '../../util/ecosystem/environment.mjs'
import type { AliasResult } from '../../util/npm/package-arg.mts'
import type { Logger } from '@socketsecurity/lib-stable/logger'
import type { PackageJson } from '@socketsecurity/lib-stable/packages/operations'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'

type AddOverridesOptions = {
  logger?: Logger | undefined
  pin?: boolean | undefined
  prod?: boolean | undefined
  spinner?: SpinnerInstance | undefined
  state?: AddOverridesState | undefined
}
type AddOverridesState = {
  added: Set<string>
  addedInWorkspaces: Set<string>
  updated: Set<string>
  updatedInWorkspaces: Set<string>
  warnedPnpmWorkspaceRequiresNpm: boolean
}

const manifestNpmOverrides = getManifestData(NPM) ?? []

export async function addOverrides(
  pkgEnvDetails: EnvDetails,
  pkgPath: string,
  options?: AddOverridesOptions | undefined,
): Promise<AddOverridesState> {
  const {
    agent,
    lockName,
    lockSrc,
    npmExecPath,
    pkgPath: rootPath,
  } = pkgEnvDetails
  const {
    logger,
    pin,
    prod,
    spinner,
    state = {
      added: new Set(),
      addedInWorkspaces: new Set(),
      updated: new Set(),
      updatedInWorkspaces: new Set(),
      warnedPnpmWorkspaceRequiresNpm: false,
    },
  } = { __proto__: null, ...options } as AddOverridesOptions
  const workspacePkgJsonPaths = await globWorkspace(agent, pkgPath)
  const isPnpm = agent === PNPM
  const isWorkspace = workspacePkgJsonPaths.length > 0
  const isWorkspaceRoot = pkgPath === rootPath
  const isLockScanned = isWorkspaceRoot && !prod
  const workspace = isWorkspaceRoot ? 'root' : path.relative(rootPath, pkgPath)
  if (
    isWorkspace &&
    isPnpm &&
    // npmExecPath will === the agent name IF it CANNOT be resolved.
    npmExecPath === NPM &&
    !state.warnedPnpmWorkspaceRequiresNpm
  ) {
    state.warnedPnpmWorkspaceRequiresNpm = true
    spinner?.stop()
    logger?.warn(
      cmdPrefixMessage(
        CMD_NAME,
        `${agent} workspace support requires \`npm ls\`, falling back to \`${agent} list\``,
      ),
    )
    spinner?.start()
  }

  const overridesDataObjects = [] as GetOverridesResult[]
  if (isWorkspace || pkgEnvDetails.editablePkgJson.content.private) {
    overridesDataObjects.push(getOverridesData(pkgEnvDetails))
  } else {
    overridesDataObjects.push(
      getOverridesDataNpm(pkgEnvDetails),
      getOverridesDataYarnClassic(pkgEnvDetails),
    )
  }

  const depAliasMap = new Map<string, string>()
  const depEntries = getDependencyEntries(pkgEnvDetails)

  const addingText = `Adding overrides to ${workspace}...`
  let loggedAddingText = false

  // Chunk package names to process them in parallel 3 at a time.
  await pEach(
    manifestNpmOverrides,
    async ({
      1: data,
    }: {
      1: { name: string; package: string; version: string }
    }) => {
      const { name: sockRegPkgName, package: origPkgName, version } = data
      const major = getMajor(version)
      if (major === undefined) {
        return
      }
      const sockOverridePrefix = `npm:${sockRegPkgName}@`
      const sockOverrideSpec = `${sockOverridePrefix}${pin ? version : `^${major}`}`
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const { 1: depObj } of depEntries) {
        const sockSpec = hasOwn(depObj, sockRegPkgName)
          ? (depObj[sockRegPkgName] as string)
          : undefined
        if (sockSpec) {
          depAliasMap.set(sockRegPkgName, sockSpec)
        }
        const origSpec = hasOwn(depObj, origPkgName)
          ? (depObj[origPkgName] as string)
          : undefined
        if (origSpec) {
          let thisSpec = origSpec
          // Add package aliases for direct dependencies to avoid npm EOVERRIDE
          // errors...
          // https://docs.npmjs.com/cli/v8/using-npm/package-spec#aliases
          if (
            // ...if the spec doesn't start with a valid Socket override.
            !(
              thisSpec.startsWith(sockOverridePrefix) &&
              (() => {
                // Check the validity of the spec by parsing it with npm-package-arg
                // and seeing if it will coerce to a version.
                const parsed = safeNpa(thisSpec)
                if (!parsed || parsed.type !== 'alias') {
                  return false
                }
                return semver.coerce((parsed as AliasResult).subSpec.rawSpec)
                  ?.version
              })()
            )
          ) {
            thisSpec = sockOverrideSpec
            depObj[origPkgName] = thisSpec
            state.added.add(sockRegPkgName)
            if (!isWorkspaceRoot) {
              state.addedInWorkspaces.add(workspace)
            }
            if (!loggedAddingText) {
              spinner?.text(addingText)
              loggedAddingText = true
            }
          }
          depAliasMap.set(origPkgName, thisSpec)
        }
      }
      if (isWorkspaceRoot) {
        // The lockSrcIncludes and lsStdoutIncludes functions overlap in their
        // first two parameters. lockSrcIncludes accepts an optional third parameter
        // which lsStdoutIncludes will ignore.
        const thingScanner = (
          isLockScanned ? lockSrcIncludes : lsStdoutIncludes
        ) as typeof lockSrcIncludes

        const thingToScan = isLockScanned
          ? lockSrc
          : await listPackages(pkgEnvDetails, { cwd: pkgPath, npmExecPath })
        // Chunk package names to process them in parallel 3 at a time.
        await pEach(
          overridesDataObjects,
          async ({ overrides, type }) => {
            const overrideExists = hasOwn(overrides, origPkgName)
            if (
              overrideExists ||
              thingScanner(pkgEnvDetails, thingToScan, origPkgName, lockName)
            ) {
              const oldSpec = overrideExists
                ? overrides[origPkgName]!
                : undefined
              const origDepAlias = depAliasMap.get(origPkgName)
              const sockRegDepAlias = depAliasMap.get(sockRegPkgName)
              const depAlias = sockRegDepAlias ?? origDepAlias
              let newSpec = sockOverrideSpec
              if (type === NPM && depAlias) {
                // With npm one may not set an override for a package that one directly
                // depends on unless both the dependency and the override itself share
                // the exact same spec. To make this limitation easier to deal with,
                // overrides may also be defined as a reference to a spec for a direct
                // dependency by prefixing the name of the package to match the version
                // of with a $.
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides
                newSpec = `$${sockRegDepAlias ? sockRegPkgName : origPkgName}`
              } else if (typeof oldSpec === 'string') {
                const thisSpec = oldSpec.startsWith('$')
                  ? depAlias || newSpec
                  : oldSpec || newSpec
                if (thisSpec.startsWith(sockOverridePrefix)) {
                  if (
                    pin &&
                    getMajor(
                      // Check the validity of the spec by parsing it with npm-package-arg
                      // and seeing if it will coerce to a version. semver.coerce
                      // will strip leading v's, carets (^), comparators (<,<=,>,>=,=),
                      // and tildes (~). If not coerced to a valid version then
                      // default to the manifest entry version.
                      (() => {
                        const parsed = safeNpa(thisSpec)
                        /* c8 ignore start - defensive: alias-spec path with semver.coerce returning falsy is unreachable in current optimize tests */
                        if (parsed && parsed.type === 'alias') {
                          return (
                            semver.coerce(
                              (parsed as AliasResult).subSpec.rawSpec,
                            )?.version ?? version
                          )
                        }
                        /* c8 ignore stop */
                        return version
                      })(),
                    ) !== major
                  ) {
                    const manifest = await fetchPackageManifest(thisSpec)
                    const otherVersion = (
                      manifest as { version?: string | undefined }
                    )?.version
                    if (otherVersion && otherVersion !== version) {
                      const otherMajor = getMajor(otherVersion)
                      if (otherMajor !== undefined) {
                        newSpec = `${sockOverridePrefix}${pin ? otherVersion : `^${otherMajor}`}`
                      }
                    }
                  }
                } else {
                  newSpec = oldSpec
                }
              }
              if (newSpec !== oldSpec) {
                overrides[origPkgName] = newSpec
                const addedOrUpdated = overrideExists ? 'updated' : 'added'
                state[addedOrUpdated].add(sockRegPkgName)
                if (!loggedAddingText) {
                  spinner?.text(addingText)
                  loggedAddingText = true
                }
              }
            }
          },
          { concurrency: 3 },
        )
      }
    },
    { concurrency: 3 },
  )

  if (isWorkspace) {
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(
      workspacePkgJsonPaths,
      async workspacePkgJsonPath => {
        const otherState = await addOverrides(
          pkgEnvDetails,
          path.dirname(workspacePkgJsonPath),
          {
            logger,
            pin,
            prod,
            spinner,
          },
        )
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const key of [
          'added',
          'addedInWorkspaces',
          'updated',
          'updatedInWorkspaces',
        ] satisfies Array<
          // of the type and that they're all Set<string> props. // Here we're just telling TS that we're looping over key names
          keyof Pick<
            AddOverridesState,
            'added' | 'addedInWorkspaces' | 'updated' | 'updatedInWorkspaces'
          >
        >) {
          // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
          for (const value of otherState[key]) {
            state[key].add(value)
          }
        }
      },
      { concurrency: 3 },
    )
  }

  if (state.added.size > 0 || state.updated.size > 0) {
    pkgEnvDetails.editablePkgJson.update(
      Object.fromEntries(depEntries) as PackageJson,
    )
    if (isWorkspaceRoot) {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const { overrides, type } of overridesDataObjects) {
        // updateManifest is async because the pnpm 11+ path writes to
        // pnpm-workspace.yaml; older pnpm and other agents resolve
        // synchronously inside this call.
        // eslint-disable-next-line no-await-in-loop -- ordering matters:
        // each agent's overrides write must complete before the next.
        await updateManifest(type, pkgEnvDetails, toSortedObject(overrides))
      }
    }
    await pkgEnvDetails.editablePkgJson.save()
  }

  return state
}
