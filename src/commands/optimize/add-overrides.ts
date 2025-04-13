import path from 'node:path'

import npa from 'npm-package-arg'
import semver from 'semver'

import { getManifestData } from '@socketsecurity/registry'
import { hasOwn, toSortedObject } from '@socketsecurity/registry/lib/objects'
import { fetchPackageManifest } from '@socketsecurity/registry/lib/packages'
import { pEach } from '@socketsecurity/registry/lib/promises'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { depsIncludesByAgent } from './deps-includes-by-agent'
import { getDependencyEntries } from './get-dependency-entries'
import { overridesDataByAgent } from './get-overrides-by-agent'
import { lockfileIncludesByAgent } from './lockfile-includes-by-agent'
import { lsByAgent } from './ls-by-agent'
import { CMD_NAME } from './shared'
import { updateManifestByAgent } from './update-manifest-by-agent'
import constants from '../../constants'
import { cmdPrefixMessage } from '../../utils/cmd'
import { globWorkspace } from '../../utils/glob'

import type { GetOverridesResult } from './get-overrides-by-agent'
import type { AgentLockIncludesFn } from './lockfile-includes-by-agent'
import type { EnvDetails } from '../../utils/package-environment'
import type { Logger } from '@socketsecurity/registry/lib/logger'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

type AddOverridesOptions = {
  logger?: Logger | undefined
  pin?: boolean | undefined
  prod?: boolean | undefined
  spinner?: Spinner | undefined
  state?: AddOverridesState | undefined
}
type AddOverridesState = {
  added: Set<string>
  addedInWorkspaces: Set<string>
  updated: Set<string>
  updatedInWorkspaces: Set<string>
  warnedPnpmWorkspaceRequiresNpm: boolean
  workspacePkgJsonPaths: string[]
}

const { NPM, PNPM, YARN_CLASSIC } = constants

const manifestNpmOverrides = getManifestData(NPM)

export async function addOverrides(
  pkgEnvDetails: EnvDetails,
  pkgPath: string,
  options?: AddOverridesOptions | undefined
): Promise<AddOverridesState> {
  const {
    agent,
    lockName,
    lockSrc,
    npmExecPath,
    pkgPath: rootPath
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
      workspacePkgJsonPaths: await globWorkspace(pkgEnvDetails)
    }
  } = { __proto__: null, ...options } as AddOverridesOptions
  const isWorkspace = state.workspacePkgJsonPaths.length > 0
  const isWorkspaceRoot = pkgPath === rootPath
  const isLockScanned = isWorkspaceRoot && !prod
  const workspaceName = isWorkspaceRoot ? '' : path.relative(rootPath, pkgPath)
  if (
    isWorkspace &&
    agent === PNPM &&
    // npmExecPath will === the agent name IF it CANNOT be resolved.
    npmExecPath === NPM &&
    !state.warnedPnpmWorkspaceRequiresNpm
  ) {
    state.warnedPnpmWorkspaceRequiresNpm = true
    logger?.warn(
      cmdPrefixMessage(
        CMD_NAME,
        `${agent} workspace support requires \`npm ls\`, falling back to \`${agent} list\``
      )
    )
  }

  const overridesDataObjects = [] as GetOverridesResult[]
  if (isWorkspace || pkgEnvDetails.editablePkgJson.content['private']) {
    overridesDataObjects.push(overridesDataByAgent.get(agent)!(pkgEnvDetails))
  } else {
    overridesDataObjects.push(
      overridesDataByAgent.get(NPM)!(pkgEnvDetails),
      overridesDataByAgent.get(YARN_CLASSIC)!(pkgEnvDetails)
    )
  }

  spinner?.setText(
    `Adding overrides${workspaceName ? ` to ${workspaceName}` : ''}...`
  )

  const depAliasMap = new Map<string, string>()
  const depEntries = getDependencyEntries(pkgEnvDetails)

  const manifestEntries = manifestNpmOverrides.filter(({ 1: data }) =>
    semver.satisfies(
      // Roughly check Node range as semver.coerce will strip leading
      // v's, carets (^), comparators (<,<=,>,>=,=), and tildes (~).
      semver.coerce(data.engines.node)!,
      pkgEnvDetails.pkgRequirements.node
    )
  )

  // Chunk package names to process them in parallel 3 at a time.
  await pEach(manifestEntries, 3, async ({ 1: data }) => {
    const { name: sockRegPkgName, package: origPkgName, version } = data
    const major = semver.major(version)
    const sockOverridePrefix = `${NPM}:${sockRegPkgName}@`
    const sockOverrideSpec = `${sockOverridePrefix}${pin ? version : `^${major}`}`
    for (const { 1: depObj } of depEntries) {
      const sockSpec = hasOwn(depObj, sockRegPkgName)
        ? depObj[sockRegPkgName]
        : undefined
      if (sockSpec) {
        depAliasMap.set(sockRegPkgName, sockSpec)
      }
      const origSpec = hasOwn(depObj, origPkgName)
        ? depObj[origPkgName]
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
            // Check the validity of the spec by passing it through npa and
            // seeing if it will coerce to a version.
            semver.coerce(npa(thisSpec).rawSpec)?.version
          )
        ) {
          thisSpec = sockOverrideSpec
          depObj[origPkgName] = thisSpec
          state.added.add(sockRegPkgName)
          if (workspaceName) {
            state.addedInWorkspaces.add(workspaceName)
          }
        }
        depAliasMap.set(origPkgName, thisSpec)
      }
    }
    if (isWorkspaceRoot) {
      // The AgentDepsIncludesFn and AgentLockIncludesFn types overlap in their
      // first two parameters. AgentLockIncludesFn accepts an optional third
      // parameter which AgentDepsIncludesFn will ignore so we cast thingScanner
      // as an AgentLockIncludesFn type.
      const thingScanner = (
        isLockScanned
          ? lockfileIncludesByAgent.get(agent)
          : depsIncludesByAgent.get(agent)
      ) as AgentLockIncludesFn
      const thingToScan = isLockScanned
        ? lockSrc
        : await lsByAgent.get(agent)!(pkgEnvDetails, pkgPath, { npmExecPath })
      // Chunk package names to process them in parallel 3 at a time.
      await pEach(overridesDataObjects, 3, async ({ overrides, type }) => {
        const overrideExists = hasOwn(overrides, origPkgName)
        if (
          overrideExists ||
          thingScanner(thingToScan, origPkgName, lockName)
        ) {
          const oldSpec = overrideExists ? overrides[origPkgName]! : undefined
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
                semver.major(
                  // Check the validity of the spec by passing it through npa
                  // and seeing if it will coerce to a version. semver.coerce
                  // will strip leading v's, carets (^), comparators (<,<=,>,>=,=),
                  // and tildes (~). If not coerced to a valid version then
                  // default to the manifest entry version.
                  semver.coerce(npa(thisSpec).rawSpec)?.version ?? version
                ) !== major
              ) {
                const otherVersion = (await fetchPackageManifest(thisSpec))
                  ?.version
                if (otherVersion && otherVersion !== version) {
                  newSpec = `${sockOverridePrefix}${pin ? otherVersion : `^${semver.major(otherVersion)}`}`
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
          }
        }
      })
    }
  })

  if (isWorkspace) {
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(state.workspacePkgJsonPaths, 3, async workspacePkgJsonPath => {
      const otherState = await addOverrides(
        pkgEnvDetails,
        path.dirname(workspacePkgJsonPath),
        {
          logger,
          pin,
          prod,
          spinner,
          state
        }
      )
      for (const key of [
        'added',
        'addedInWorkspaces',
        'updated',
        'updatedInWorkspaces'
      ] satisfies
        // Here we're just telling TS that we're looping over key names
        // of the type and that they're all Set<string> props. This allows
        // us to do the SetA.add(setB.get) pump type-safe without casts.
        Array<
          keyof Pick<
            AddOverridesState,
            'added' | 'addedInWorkspaces' | 'updated' | 'updatedInWorkspaces'
          >
        >) {
        for (const value of otherState[key]) {
          state[key].add(value)
        }
      }
    })
  }

  if (state.added.size > 0 || state.updated.size > 0) {
    pkgEnvDetails.editablePkgJson.update(
      Object.fromEntries(depEntries) as PackageJson
    )
    for (const { overrides, type } of overridesDataObjects) {
      updateManifestByAgent.get(type)!(pkgEnvDetails, toSortedObject(overrides))
    }
    await pkgEnvDetails.editablePkgJson.save()
  }

  return state
}
