import fs from 'fs/promises'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import meow from 'meow'
import npa from 'npm-package-arg'
import semver from 'semver'
import { glob as tinyGlob } from 'tinyglobby'
import { parse as yamlParse } from 'yaml'

import { getManifestData } from '@socketsecurity/registry'
import {
  hasKeys,
  hasOwn,
  isObject,
  toSortedObject
} from '@socketsecurity/registry/lib/objects'
import {
  fetchPackageManifest,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'
import { pEach } from '@socketsecurity/registry/lib/promises'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'
import { Spinner } from '@socketsecurity/registry/lib/spinner'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../constants'
import { commonFlags } from '../flags'
import { printFlagList } from '../utils/formatting'
import { existsSync } from '../utils/fs'
import { detect } from '../utils/package-manager-detector'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  StringKeyValueObject
} from '../utils/package-manager-detector'
import type { ManifestEntry } from '@socketsecurity/registry'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>

const {
  BUN,
  LOCK_EXT,
  NPM,
  OVERRIDES,
  PNPM,
  RESOLUTIONS,
  SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
  abortSignal,
  execPath,
  rootBinPath
} = constants

const COMMAND_TITLE = 'Socket Optimize'
const NPM_OVERRIDE_PR_URL = 'https://github.com/npm/cli/pull/7025'
const PNPM_FIELD_NAME = PNPM
const PNPM_WORKSPACE = `${PNPM}-workspace`

const manifestNpmOverrides = getManifestData(NPM)!

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkgJson: PackageJson) => GetOverridesResult
type GetOverridesResult = {
  type: Agent
  overrides: Overrides
}

const getOverridesDataByAgent: Record<Agent, GetOverrides> = {
  [BUN](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
    return { type: YARN_BERRY, overrides }
  },
  // npm overrides documentation:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
  [NPM](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.[OVERRIDES] ?? {}
    return { type: NPM, overrides }
  },
  // pnpm overrides documentation:
  // https://pnpm.io/package_json#pnpmoverrides
  [PNPM](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.pnpm?.[OVERRIDES] ?? {}
    return { type: PNPM, overrides }
  },
  [VLT](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.[OVERRIDES] ?? {}
    return { type: VLT, overrides }
  },
  // Yarn resolutions documentation:
  // https://yarnpkg.com/configuration/manifest#resolutions
  [YARN_BERRY](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
    return { type: YARN_BERRY, overrides }
  },
  // Yarn resolutions documentation:
  // https://classic.yarnpkg.com/en/docs/selective-version-resolutions
  [YARN_CLASSIC](pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.[RESOLUTIONS] ?? {}
    return { type: YARN_CLASSIC, overrides }
  }
}

type AgentLockIncludesFn = (
  lockSrc: string,
  name: string,
  ext?: string
) => boolean

const lockIncludesByAgent: Record<Agent, AgentLockIncludesFn> = (() => {
  function npmLockIncludes(lockSrc: string, name: string) {
    // Detects the package name in the following cases:
    //   "name":
    return lockSrc.includes(`"${name}":`)
  }

  function yarnLockIncludes(lockSrc: string, name: string) {
    const escapedName = escapeRegExp(name)
    return new RegExp(
      // Detects the package name in the following cases:
      //   "name@
      //   , "name@
      //   name@
      //   , name@
      `(?<=(?:^\\s*|,\\s*)"?)${escapedName}(?=@)`,
      'm'
    ).test(lockSrc)
  }

  return {
    [BUN](lockSrc: string, name: string, lockBasename?: string) {
      // This is a bit counterintuitive. When lockBasename ends with a .lockb
      // we treat it as a yarn.lock. When lockBasename ends with a .lock we
      // treat it as a package-lock.json. The bun.lock format is not identical
      // package-lock.json, however it close enough for npmLockIncludes to work.
      const lockScanner = lockBasename?.endsWith(LOCK_EXT)
        ? npmLockIncludes
        : yarnLockIncludes
      return lockScanner(lockSrc, name)
    },
    [NPM]: npmLockIncludes,
    [PNPM](lockSrc: string, name: string) {
      const escapedName = escapeRegExp(name)
      return new RegExp(
        // Detects the package name in the following cases:
        //   /name/
        //   'name'
        //   name:
        //   name@
        `(?<=^\\s*)(?:(['/])${escapedName}\\1|${escapedName}(?=[:@]))`,
        'm'
      ).test(lockSrc)
    },
    [VLT](lockSrc: string, name: string) {
      // Detects the package name in the following cases:
      //   "name"
      return lockSrc.includes(`"${name}"`)
    },
    [YARN_BERRY]: yarnLockIncludes,
    [YARN_CLASSIC]: yarnLockIncludes
  }
})()

type AgentModifyManifestFn = (
  pkgJson: EditablePackageJson,
  overrides: Overrides
) => void

const updateManifestByAgent: Record<Agent, AgentModifyManifestFn> = (() => {
  const depFields = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'optionalDependencies',
    'bundleDependencies'
  ]

  function getEntryIndexes(
    entries: [string | symbol, any][],
    keys: (string | symbol)[]
  ): number[] {
    return keys
      .map(n => entries.findIndex(p => p[0] === n))
      .filter(n => n !== -1)
      .sort((a, b) => a - b)
  }

  function getLowestEntryIndex(
    entries: [string | symbol, any][],
    keys: (string | symbol)[]
  ) {
    return getEntryIndexes(entries, keys)?.[0] ?? -1
  }

  function getHighestEntryIndex(
    entries: [string | symbol, any][],
    keys: (string | symbol)[]
  ) {
    return getEntryIndexes(entries, keys).at(-1) ?? -1
  }

  function updatePkgJson(
    editablePkgJson: EditablePackageJson,
    field: string,
    value: any
  ) {
    const pkgJson = editablePkgJson.content
    const oldValue = pkgJson[field]
    if (oldValue) {
      // The field already exists so we simply update the field value.
      if (field === PNPM_FIELD_NAME) {
        if (hasKeys(value)) {
          editablePkgJson.update({
            [field]: {
              ...(isObject(oldValue) ? oldValue : {}),
              overrides: value
            }
          })
        } else {
          // Properties with undefined values are omitted when saved as JSON.
          editablePkgJson.update(
            <typeof pkgJson>(hasKeys(pkgJson[field])
              ? {
                  [field]: {
                    ...(isObject(oldValue) ? oldValue : {}),
                    overrides: undefined
                  }
                }
              : { [field]: undefined })
          )
        }
      } else if (field === OVERRIDES || field === RESOLUTIONS) {
        // Properties with undefined values are omitted when saved as JSON.
        editablePkgJson.update(<typeof pkgJson>{
          [field]: hasKeys(value) ? value : undefined
        })
      } else {
        editablePkgJson.update({ [field]: value })
      }
      return
    }
    if (
      (field === OVERRIDES ||
        field === PNPM_FIELD_NAME ||
        field === RESOLUTIONS) &&
      !hasKeys(value)
    ) {
      return
    }
    // Since the field doesn't exist we want to insert it into the package.json
    // in a place that makes sense, e.g. close to the "dependencies" field. If
    // we can't find a place to insert the field we'll add it to the bottom.
    const entries = Object.entries(pkgJson)
    let insertIndex = -1
    let isPlacingHigher = false
    if (field === OVERRIDES) {
      insertIndex = getLowestEntryIndex(entries, [RESOLUTIONS])
      if (insertIndex === -1) {
        isPlacingHigher = true
        insertIndex = getHighestEntryIndex(entries, [...depFields, PNPM])
      }
    } else if (field === RESOLUTIONS) {
      isPlacingHigher = true
      insertIndex = getHighestEntryIndex(entries, [
        ...depFields,
        OVERRIDES,
        PNPM
      ])
    } else if (field === PNPM_FIELD_NAME) {
      insertIndex = getLowestEntryIndex(entries, [OVERRIDES, RESOLUTIONS])
      if (insertIndex === -1) {
        isPlacingHigher = true
        insertIndex = getHighestEntryIndex(entries, depFields)
      }
    }
    if (insertIndex === -1) {
      insertIndex = getLowestEntryIndex(entries, ['engines', 'files'])
    }
    if (insertIndex === -1) {
      isPlacingHigher = true
      insertIndex = getHighestEntryIndex(entries, [
        'exports',
        'imports',
        'main'
      ])
    }
    if (insertIndex === -1) {
      insertIndex = entries.length
    } else if (isPlacingHigher) {
      insertIndex += 1
    }
    entries.splice(insertIndex, 0, [field, value])
    editablePkgJson.fromJSON(
      `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
    )
  }

  function updateOverrides(
    editablePkgJson: EditablePackageJson,
    overrides: Overrides
  ) {
    updatePkgJson(editablePkgJson, OVERRIDES, overrides)
  }

  function updateResolutions(
    editablePkgJson: EditablePackageJson,
    overrides: Overrides
  ) {
    updatePkgJson(editablePkgJson, RESOLUTIONS, <PnpmOrYarnOverrides>overrides)
  }

  return {
    [BUN]: updateResolutions,
    [NPM]: updateOverrides,
    [PNPM](editablePkgJson: EditablePackageJson, overrides: Overrides) {
      updatePkgJson(editablePkgJson, PNPM_FIELD_NAME, overrides)
    },
    [VLT]: updateOverrides,
    [YARN_BERRY]: updateResolutions,
    [YARN_CLASSIC]: updateResolutions
  }
})()

type AgentListDepsOptions = {
  npmExecPath?: string
}
type AgentListDepsFn = (
  agentExecPath: string,
  cwd: string,
  options?: AgentListDepsOptions
) => Promise<string>

const lsByAgent = (() => {
  function cleanupQueryStdout(stdout: string): string {
    if (stdout === '') {
      return ''
    }
    let pkgs
    try {
      pkgs = JSON.parse(stdout)
    } catch {}
    if (!Array.isArray(pkgs)) {
      return ''
    }
    const names = new Set<string>()
    for (const { _id, name, pkgid } of pkgs) {
      // `npm query` results may not have a "name" property, in which case we
      // fallback to "_id" and then "pkgid".
      // `vlt ls --view json` results always have a "name" property.
      const fallback = _id ?? pkgid ?? ''
      const resolvedName = name ?? fallback.slice(0, fallback.indexOf('@', 1))
      // Add package names, except for those under the `@types` scope as those
      // are known to only be dev dependencies.
      if (resolvedName && !resolvedName.startsWith('@types/')) {
        names.add(resolvedName)
      }
    }
    return JSON.stringify([...names], null, 2)
  }

  function parseableToQueryStdout(stdout: string) {
    if (stdout === '') {
      return ''
    }
    // Convert the parseable stdout into a json array of unique names.
    // The matchAll regexp looks for a forward (posix) or backward (win32) slash
    // and matches one or more non-slashes until the newline.
    const names = new Set(stdout.matchAll(/(?<=[/\\])[^/\\]+(?=\n)/g))
    return JSON.stringify([...names], null, 2)
  }

  async function npmQuery(npmExecPath: string, cwd: string): Promise<string> {
    let stdout = ''
    try {
      stdout = (await spawn(npmExecPath, ['query', ':not(.dev)'], { cwd }))
        .stdout
    } catch {}
    return cleanupQueryStdout(stdout)
  }

  return <Record<Agent, AgentListDepsFn>>{
    async [BUN](agentExecPath: string, cwd: string) {
      try {
        // Bun does not support filtering by production packages yet.
        // https://github.com/oven-sh/bun/issues/8283
        return (await spawn(agentExecPath!, ['pm', 'ls', '--all'], { cwd }))
          .stdout
      } catch {}
      return ''
    },
    async [NPM](agentExecPath: string, cwd: string) {
      return await npmQuery(agentExecPath, cwd)
    },
    async [PNPM](
      agentExecPath: string,
      cwd: string,
      options: AgentListDepsOptions
    ) {
      const { npmExecPath } = <AgentListDepsOptions>{
        __proto__: null,
        ...options
      }
      if (npmExecPath && npmExecPath !== NPM) {
        const result = await npmQuery(npmExecPath, cwd)
        if (result) {
          return result
        }
      }
      let stdout = ''
      try {
        stdout = (
          await spawn(
            agentExecPath,
            ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
            { cwd }
          )
        ).stdout
      } catch {}
      return parseableToQueryStdout(stdout)
    },
    async [VLT](agentExecPath: string, cwd: string) {
      let stdout = ''
      try {
        stdout = (
          await spawn(agentExecPath, ['ls', '--view', 'human', ':not(.dev)'], {
            cwd
          })
        ).stdout
      } catch {}
      return cleanupQueryStdout(stdout)
    },
    async [YARN_BERRY](agentExecPath: string, cwd: string) {
      try {
        return (
          // Yarn Berry does not support filtering by production packages yet.
          // https://github.com/yarnpkg/berry/issues/5117
          (
            await spawn(agentExecPath, ['info', '--recursive', '--name-only'], {
              cwd
            })
          ).stdout.trim()
        )
      } catch {}
      return ''
    },
    async [YARN_CLASSIC](agentExecPath: string, cwd: string) {
      try {
        // However, Yarn Classic does support it.
        // https://github.com/yarnpkg/yarn/releases/tag/v1.0.0
        // > Fix: Excludes dev dependencies from the yarn list output when the
        //   environment is production
        return (
          await spawn(agentExecPath, ['list', '--prod'], { cwd })
        ).stdout.trim()
      } catch {}
      return ''
    }
  }
})()

type AgentDepsIncludesFn = (stdout: string, name: string) => boolean

const depsIncludesByAgent: Record<Agent, AgentDepsIncludesFn> = (() => {
  function matchHumanStdout(stdout: string, name: string) {
    return stdout.includes(` ${name}@`)
  }

  function matchQueryStdout(stdout: string, name: string) {
    return stdout.includes(`"${name}"`)
  }

  return {
    [BUN]: matchHumanStdout,
    [NPM]: matchQueryStdout,
    [PNPM]: matchQueryStdout,
    [VLT]: matchQueryStdout,
    [YARN_BERRY]: matchHumanStdout,
    [YARN_CLASSIC]: matchHumanStdout
  }
})()

function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number
) {
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', overrideCount)}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', workspaceCount)}` : ''}`
}

function getDependencyEntries(pkgJson: PackageJson) {
  const {
    dependencies,
    devDependencies,
    optionalDependencies,
    peerDependencies
  } = pkgJson
  return <[string, NonNullable<typeof dependencies>][]>[
    [
      'dependencies',
      dependencies ? { __proto__: null, ...dependencies } : undefined
    ],
    [
      'devDependencies',
      devDependencies ? { __proto__: null, ...devDependencies } : undefined
    ],
    [
      'peerDependencies',
      peerDependencies ? { __proto__: null, ...peerDependencies } : undefined
    ],
    [
      'optionalDependencies',
      optionalDependencies
        ? { __proto__: null, ...optionalDependencies }
        : undefined
    ]
  ].filter(({ 1: o }) => o)
}

async function getWorkspaceGlobs(
  agent: Agent,
  pkgPath: string,
  pkgJson: PackageJson
): Promise<string[] | undefined> {
  let workspacePatterns
  if (agent === PNPM) {
    for (const workspacePath of [
      path.join(pkgPath!, `${PNPM_WORKSPACE}.yaml`),
      path.join(pkgPath!, `${PNPM_WORKSPACE}.yml`)
    ]) {
      if (existsSync(workspacePath)) {
        try {
          workspacePatterns = yamlParse(
            // eslint-disable-next-line no-await-in-loop
            await fs.readFile(workspacePath, 'utf8')
          )?.packages
        } catch {}
        if (workspacePatterns) {
          break
        }
      }
    }
  } else {
    workspacePatterns = pkgJson['workspaces']
  }
  return Array.isArray(workspacePatterns)
    ? workspacePatterns
        .filter(isNonEmptyString)
        .map(workspacePatternToGlobPattern)
    : undefined
}

function workspacePatternToGlobPattern(workspace: string): string {
  const { length } = workspace
  if (!length) {
    return ''
  }
  // If the workspace ends with "/"
  if (workspace.charCodeAt(length - 1) === 47 /*'/'*/) {
    return `${workspace}/*/package.json`
  }
  // If the workspace ends with "/**"
  if (
    workspace.charCodeAt(length - 1) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 2) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 3) === 47 /*'/'*/
  ) {
    return `${workspace}/*/**/package.json`
  }
  // Things like "packages/a" or "packages/*"
  return `${workspace}/package.json`
}

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
  spinner?: Spinner | undefined
  updated: Set<string>
  updatedInWorkspaces: Set<string>
  warnedPnpmWorkspaceRequiresNpm: boolean
}

function createAddOverridesState(initials?: any): AddOverridesState {
  return {
    added: new Set(),
    addedInWorkspaces: new Set(),
    spinner: undefined,
    updated: new Set(),
    updatedInWorkspaces: new Set(),
    warnedPnpmWorkspaceRequiresNpm: false,
    ...initials
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
  state = createAddOverridesState()
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
  const depAliasMap = new Map<string, { id: string; version: string }>()
  // Chunk package names to process them in parallel 3 at a time.
  await pEach(manifestEntries, 3, async ({ 1: data }) => {
    const { name: regPkgName, package: origPkgName, version } = data
    const major = semver.major(version)
    for (const { 1: depObj } of depEntries) {
      let pkgSpec = depObj[origPkgName]
      if (pkgSpec) {
        let thisVersion = version
        // Add package aliases for direct dependencies to avoid npm EOVERRIDE errors.
        // https://docs.npmjs.com/cli/v8/using-npm/package-spec#aliases
        const regSpecStartsLike = `npm:${regPkgName}@`
        const existingVersion = pkgSpec.startsWith(regSpecStartsLike)
          ? (semver.coerce(npa(pkgSpec).rawSpec)?.version ?? '')
          : ''
        if (existingVersion) {
          thisVersion = existingVersion
        } else {
          pkgSpec = `${regSpecStartsLike}^${version}`
          depObj[origPkgName] = pkgSpec
          state.added.add(regPkgName)
          if (workspaceName) {
            state.addedInWorkspaces.add(workspaceName)
          }
        }
        depAliasMap.set(origPkgName, {
          id: pkgSpec,
          version: thisVersion
        })
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
          const oldSpec = overrideExists ? overrides[origPkgName] : undefined
          const depAlias = depAliasMap.get(origPkgName)
          const regSpecStartsLike = `${NPM}:${regPkgName}@`
          let newSpec = `${regSpecStartsLike}^${pin ? version : major}`
          let thisVersion = version
          if (depAlias && type === NPM) {
            // With npm one may not set an override for a package that one directly
            // depends on unless both the dependency and the override itself share
            // the exact same spec. To make this limitation easier to deal with,
            // overrides may also be defined as a reference to a spec for a direct
            // dependency by prefixing the name of the package to match the version
            // of with a $.
            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides
            newSpec = `$${origPkgName}`
          } else if (overrideExists) {
            const thisSpec = oldSpec.startsWith('$')
              ? (depAlias?.id ?? newSpec)
              : (oldSpec ?? newSpec)
            if (thisSpec.startsWith(regSpecStartsLike)) {
              if (pin) {
                thisVersion =
                  semver.major(
                    semver.coerce(npa(thisSpec).rawSpec)?.version ?? version
                  ) === major
                    ? version
                    : ((await fetchPackageManifest(thisSpec))?.version ??
                      version)
              }
              newSpec = `${regSpecStartsLike}^${pin ? thisVersion : semver.major(thisVersion)}`
            } else {
              newSpec = oldSpec
            }
          }
          if (newSpec !== oldSpec) {
            overrides[origPkgName] = newSpec
            const addedOrUpdated = overrideExists ? 'updated' : 'added'
            state[addedOrUpdated].add(regPkgName)
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
        createAddOverridesState({ spinner })
      )
      for (const key of [
        'added',
        'addedInWorkspaces',
        'updated',
        'updatedInWorkspaces'
      ]) {
        for (const value of (otherState as any)[key]) {
          ;(state as any)[key].add(value)
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

export const optimize: CliSubcommand = {
  description: 'Optimize dependencies with @socketregistry overrides',
  async run(argv, importMeta, { parentName }) {
    const commandContext = setupCommand(
      `${parentName} optimize`,
      optimize.description,
      argv,
      importMeta
    )
    if (!commandContext) {
      return
    }
    const { pin, prod } = commandContext
    const cwd = process.cwd()
    const {
      agent,
      agentExecPath,
      agentVersion,
      lockBasename,
      lockPath,
      lockSrc,
      minimumNodeVersion,
      npmExecPath,
      pkgJson,
      pkgPath,
      supported
    } = await detect({
      cwd,
      onUnknown(pkgManager: string | undefined) {
        console.warn(
          `⚠️ ${COMMAND_TITLE}: Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`
        )
      }
    })
    if (!supported) {
      console.error(
        `✖️ ${COMMAND_TITLE}: No supported Node or browser range detected`
      )
      return
    }
    if (agent === VLT) {
      console.error(
        `✖️ ${COMMAND_TITLE}: ${agent} does not support overrides. Soon, though ⚡`
      )
      return
    }
    const lockName = lockPath ? lockBasename : 'lock file'
    if (lockBasename === undefined || lockSrc === undefined) {
      console.error(`✖️ ${COMMAND_TITLE}: No ${lockName} found`)
      return
    }
    if (lockSrc.trim() === '') {
      console.error(`✖️ ${COMMAND_TITLE}: ${lockName} is empty`)
      return
    }
    if (pkgPath === undefined) {
      console.error(`✖️ ${COMMAND_TITLE}: No package.json found`)
      return
    }
    if (prod && (agent === BUN || agent === YARN_BERRY)) {
      console.error(
        `✖️ ${COMMAND_TITLE}: --prod not supported for ${agent}${agentVersion ? `@${agentVersion.toString()}` : ''}`
      )
      return
    }
    if (lockPath && path.relative(cwd, lockPath).startsWith('.')) {
      console.warn(
        `⚠️ ${COMMAND_TITLE}: Package ${lockName} found at ${lockPath}`
      )
    }
    const spinner = new Spinner({ text: 'Socket optimizing...' })
    const state = createAddOverridesState({ spinner })
    spinner.start()
    const nodeRange = `>=${minimumNodeVersion}`
    const manifestEntries = manifestNpmOverrides.filter(({ 1: data }) =>
      semver.satisfies(semver.coerce(data.engines.node)!, nodeRange)
    )
    await addOverrides(
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
      state
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
    const isNpm = agent === NPM
    if (isNpm || pkgJsonChanged) {
      // Always update package-lock.json until the npm overrides PR lands:
      // https://github.com/npm/cli/pull/7025
      spinner.start(`Updating ${lockName}...`)
      try {
        if (isNpm) {
          const wrapperPath = path.join(rootBinPath, 'npm-cli.js')
          const npmSpawnOptions: Parameters<typeof spawn>[2] = {
            signal: abortSignal,
            stdio: 'inherit',
            env: {
              ...process.env,
              [SOCKET_CLI_UPDATE_OVERRIDES_IN_PACKAGE_LOCK_FILE]: '1'
            }
          }
          await spawn(execPath, [wrapperPath, 'install'], npmSpawnOptions)
          // TODO: This is a temporary workaround for a `npm ci` bug where it
          // will error out after Socket Optimize generates a lock file. More
          // investigation is needed.
          await spawn(
            execPath,
            [wrapperPath, 'install', '--ignore-scripts', '--package-lock-only'],
            npmSpawnOptions
          )
        } else {
          // All package managers support the "install" command.
          await spawn(agentExecPath, ['install'], {
            signal: abortSignal,
            stdio: 'ignore'
          })
        }
        spinner.stop()
        if (isNpm) {
          console.log(
            `💡 Re-run ${COMMAND_TITLE} whenever ${lockName} changes.\n   This can be skipped once npm ships ${NPM_OVERRIDE_PR_URL}.`
          )
        }
      } catch (e: any) {
        spinner.error(
          `${COMMAND_TITLE}: ${agent} install failed to update ${lockName}`
        )
        console.error(e)
      }
    }
  }
}

// Internal functions

type CommandContext = {
  pin: boolean
  prod: boolean
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    pin: {
      type: 'boolean',
      default: false,
      description: 'Pin overrides to their latest version'
    },
    prod: {
      type: 'boolean',
      default: false,
      description: 'Only add overrides for production dependencies'
    }
  }
  const cli = meow(
    `
    Usage
      $ ${name}

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name}
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  const { help, pin, prod } = cli.flags
  if (help) {
    cli.showHelp()
    return
  }
  return <CommandContext>{
    pin,
    prod
  }
}
