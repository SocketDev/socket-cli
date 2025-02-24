import path from 'node:path'

import npa from 'npm-package-arg'
import semver from 'semver'
import { glob as tinyGlob } from 'tinyglobby'

import { type ManifestEntry } from '@socketsecurity/registry'
import { hasOwn, toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  fetchPackageManifest,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { type EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import { pEach } from '@socketsecurity/registry/lib/promises'
import { Spinner } from '@socketsecurity/registry/lib/spinner'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { depsIncludesByAgent } from './deps-includes-by-agent.ts'
import { detectAndValidatePackageManager } from './detect-and-validate-package-manager.ts'
import { getDependencyEntries } from './get-dependency-entries.ts'
import { getOverridesDataByAgent } from './get-overrides-by-agent.ts'
import { getWorkspaceGlobs } from './get-workspace-globs.ts'
import {
  AgentLockIncludesFn,
  lockIncludesByAgent
} from './lock-includes-by-agent.ts'
import { lsByAgent } from './ls-by-agent.ts'
import { updateManifestByAgent } from './update-manifest-by-agent.ts'
import { updatePackageLockJson } from './update-package-lock-json.ts'
import constants from '../../constants.ts'

import type {
  Agent,
  StringKeyValueObject
} from '../../utils/package-manager-detector.ts'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>

type AddOverridesConfig = {
  agent: Agent
  agentExecPath: string
  lockBasename: string
  lockSrc: string
  manifestEntries: ManifestEntry[]
  npmExecPath: string
  pkgJson?: EditablePackageJson | undefined
  pkgPath: string
  pin?: boolean | undefined
  prod?: boolean | undefined
  rootPath: string
}

type AddOverridesState = {
  added: Set<string>
  addedInWorkspaces: Set<string>
  spinner: Spinner
  updated: Set<string>
  updatedInWorkspaces: Set<string>
  warnedPnpmWorkspaceRequiresNpm: boolean
}

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverridesResult = { type: Agent; overrides: Overrides }

const { NPM, PNPM, YARN_CLASSIC } = constants

const COMMAND_TITLE = 'Socket Optimize'

export async function applyOptimization(
  cwd: string,
  pin: boolean,
  prod: boolean
) {
  const pkgMgrData = await detectAndValidatePackageManager(cwd, prod)
  if (!pkgMgrData) return

  const {
    agent,
    agentExecPath,
    lockBasename,
    lockName,
    lockSrc,
    manifestEntries,
    npmExecPath,
    pkgJson,
    pkgPath
  } = pkgMgrData

  const spinner = new Spinner({ text: 'Socket optimizing...' })
  spinner.start()

  const state = await addOverrides(
    {
      agent,
      agentExecPath,
      lockBasename,
      lockSrc,
      manifestEntries,
      npmExecPath,
      pin,
      pkgJson,
      pkgPath,
      prod,
      rootPath: pkgPath
    },
    createAddOverridesState(spinner)
  )

  spinner.stop()

  const addedCount = state.added.size
  const updatedCount = state.updated.size
  const pkgJsonChanged = addedCount > 0 || updatedCount > 0
  if (pkgJsonChanged) {
    if (updatedCount > 0) {
      console.log(
        `${createActionMessage('Updated', updatedCount, state.updatedInWorkspaces.size)}${addedCount ? '.' : '🚀'}`
      )
    }
    if (addedCount > 0) {
      console.log(
        `${createActionMessage('Added', addedCount, state.addedInWorkspaces.size)} 🚀`
      )
    }
  } else {
    console.log('Congratulations! Already Socket.dev optimized 🎉')
  }

  if (agent === NPM || pkgJsonChanged) {
    // Always update package-lock.json until the npm overrides PR lands:
    // https://github.com/npm/cli/pull/7025
    await updatePackageLockJson(lockName, agentExecPath, agent, spinner)
  }
}

function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number
): string {
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', overrideCount)}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', workspaceCount)}` : ''}`
}

function createAddOverridesState(spinner: Spinner): AddOverridesState {
  return {
    added: new Set(),
    addedInWorkspaces: new Set(),
    spinner,
    updated: new Set(),
    updatedInWorkspaces: new Set(),
    warnedPnpmWorkspaceRequiresNpm: false
  }
}

async function addOverrides(
  {
    agent,
    agentExecPath,
    lockBasename,
    lockSrc,
    manifestEntries,
    npmExecPath,
    pin,
    pkgJson: editablePkgJson,
    pkgPath,
    prod,
    rootPath
  }: AddOverridesConfig,
  state: AddOverridesState
): Promise<AddOverridesState> {
  if (editablePkgJson === undefined) {
    editablePkgJson = await readPackageJson(pkgPath, { editable: true })
  }
  const { spinner } = state
  const { content: pkgJson } = editablePkgJson
  const isRoot = pkgPath === rootPath
  const isLockScanned = isRoot && !prod
  const workspaceName = path.relative(rootPath, pkgPath)
  const workspaceGlobs = await getWorkspaceGlobs(agent, pkgPath, pkgJson)
  const isWorkspace = !!workspaceGlobs
  if (
    isWorkspace &&
    agent === PNPM &&
    npmExecPath === NPM &&
    !state.warnedPnpmWorkspaceRequiresNpm
  ) {
    state.warnedPnpmWorkspaceRequiresNpm = true
    console.warn(
      `⚠️ ${COMMAND_TITLE}: pnpm workspace support requires \`npm ls\`, falling back to \`pnpm list\``
    )
  }
  const thingToScan = isLockScanned
    ? lockSrc
    : await lsByAgent[agent](agentExecPath, pkgPath, { npmExecPath })
  // The AgentDepsIncludesFn and AgentLockIncludesFn types overlap in their
  // first two parameters. AgentLockIncludesFn accepts an optional third
  // parameter which AgentDepsIncludesFn will ignore so we cast thingScanner
  // as an AgentLockIncludesFn type.
  const thingScanner = <AgentLockIncludesFn>(
    (isLockScanned ? lockIncludesByAgent[agent] : depsIncludesByAgent[agent])
  )
  const depEntries = getDependencyEntries(pkgJson)

  const overridesDataObjects = <GetOverridesResult[]>[]
  if (pkgJson['private'] || isWorkspace) {
    overridesDataObjects.push(getOverridesDataByAgent[agent](pkgJson))
  } else {
    overridesDataObjects.push(
      getOverridesDataByAgent[NPM](pkgJson),
      getOverridesDataByAgent[YARN_CLASSIC](pkgJson)
    )
  }
  if (spinner) {
    spinner.text = `Adding overrides${workspaceName ? ` to ${workspaceName}` : ''}...`
  }
  const depAliasMap = new Map<string, string>()
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
        // Add package aliases for direct dependencies to avoid npm EOVERRIDE errors.
        // https://docs.npmjs.com/cli/v8/using-npm/package-spec#aliases
        if (
          !(
            thisSpec.startsWith(sockOverridePrefix) &&
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
    if (isRoot) {
      // Chunk package names to process them in parallel 3 at a time.
      await pEach(overridesDataObjects, 3, async ({ overrides, type }) => {
        const overrideExists = hasOwn(overrides, origPkgName)
        if (
          overrideExists ||
          thingScanner(thingToScan, origPkgName, lockBasename)
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
  if (workspaceGlobs) {
    const workspacePkgJsonPaths = await tinyGlob(workspaceGlobs, {
      absolute: true,
      cwd: pkgPath!,
      ignore: ['**/node_modules/**', '**/bower_components/**']
    })
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(workspacePkgJsonPaths, 3, async workspacePkgJsonPath => {
      const otherState = await addOverrides(
        {
          agent,
          agentExecPath,
          lockBasename,
          lockSrc,
          manifestEntries,
          npmExecPath,
          pin,
          pkgPath: path.dirname(workspacePkgJsonPath),
          prod,
          rootPath
        },
        createAddOverridesState(spinner)
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
    editablePkgJson.update(<PackageJson>Object.fromEntries(depEntries))
    for (const { overrides, type } of overridesDataObjects) {
      updateManifestByAgent[type](editablePkgJson, toSortedObject(overrides))
    }
    await editablePkgJson.save()
  }
  return state
}
