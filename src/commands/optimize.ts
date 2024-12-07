import fs from 'fs/promises'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import meow from 'meow'
import npa from 'npm-package-arg'
import yoctoSpinner from '@socketregistry/yocto-spinner'
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
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'
import { pluralize } from '@socketsecurity/registry/lib/words'

import {
  UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE,
  distPath
} from '../constants'
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
import type { Spinner } from '@socketregistry/yocto-spinner'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>

const COMMAND_TITLE = 'Socket Optimize'
const OVERRIDES_FIELD_NAME = 'overrides'
const NPM_OVERRIDE_PR_URL = 'https://github.com/npm/cli/pull/7025'
const PNPM_FIELD_NAME = 'pnpm'
const PNPM_WORKSPACE = 'pnpm-workspace'
const RESOLUTIONS_FIELD_NAME = 'resolutions'

const manifestNpmOverrides = getManifestData('npm')!

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkgJson: PackageJson) => GetOverridesResult
type GetOverridesResult = {
  type: Agent
  overrides: Overrides
}

const getOverridesDataByAgent: Record<Agent, GetOverrides> = {
  bun(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/berry', overrides }
  },
  // npm overrides documentation:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
  npm(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.overrides ?? {}
    return { type: 'npm', overrides }
  },
  // pnpm overrides documentation:
  // https://pnpm.io/package_json#pnpmoverrides
  pnpm(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.pnpm?.overrides ?? {}
    return { type: 'pnpm', overrides }
  },
  vlt(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.overrides ?? {}
    return { type: 'vlt', overrides }
  },
  // Yarn resolutions documentation:
  // https://yarnpkg.com/configuration/manifest#resolutions
  'yarn/berry'(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/berry', overrides }
  },
  // Yarn resolutions documentation:
  // https://classic.yarnpkg.com/en/docs/selective-version-resolutions
  'yarn/classic'(pkgJson: PackageJson) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/classic', overrides }
  }
}

type AgentLockIncludesFn = (lockSrc: string, name: string) => boolean

const lockIncludesByAgent: Record<Agent, AgentLockIncludesFn> = (() => {
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
    bun: yarnLockIncludes,
    npm(lockSrc: string, name: string) {
      // Detects the package name in the following cases:
      //   "name":
      return lockSrc.includes(`"${name}":`)
    },
    pnpm(lockSrc: string, name: string) {
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
    vlt(lockSrc: string, name: string) {
      // Detects the package name in the following cases:
      //   "name"
      return lockSrc.includes(`"${name}"`)
    },
    'yarn/berry': yarnLockIncludes,
    'yarn/classic': yarnLockIncludes
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
      } else if (
        field === OVERRIDES_FIELD_NAME ||
        field === RESOLUTIONS_FIELD_NAME
      ) {
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
      (field === OVERRIDES_FIELD_NAME ||
        field === PNPM_FIELD_NAME ||
        field === RESOLUTIONS_FIELD_NAME) &&
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
    if (field === OVERRIDES_FIELD_NAME) {
      insertIndex = getLowestEntryIndex(entries, ['resolutions'])
      if (insertIndex === -1) {
        isPlacingHigher = true
        insertIndex = getHighestEntryIndex(entries, [...depFields, 'pnpm'])
      }
    } else if (field === RESOLUTIONS_FIELD_NAME) {
      isPlacingHigher = true
      insertIndex = getHighestEntryIndex(entries, [
        ...depFields,
        'overrides',
        'pnpm'
      ])
    } else if (field === PNPM_FIELD_NAME) {
      insertIndex = getLowestEntryIndex(entries, ['overrides', 'resolutions'])
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
    updatePkgJson(editablePkgJson, OVERRIDES_FIELD_NAME, overrides)
  }

  function updateResolutions(
    editablePkgJson: EditablePackageJson,
    overrides: Overrides
  ) {
    updatePkgJson(
      editablePkgJson,
      RESOLUTIONS_FIELD_NAME,
      <PnpmOrYarnOverrides>overrides
    )
  }

  return {
    bun: updateResolutions,
    npm: updateOverrides,
    pnpm(editablePkgJson: EditablePackageJson, overrides: Overrides) {
      updatePkgJson(editablePkgJson, PNPM_FIELD_NAME, overrides)
    },
    vlt: updateOverrides,
    'yarn/berry': updateResolutions,
    'yarn/classic': updateResolutions
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
    async bun(agentExecPath: string, cwd: string) {
      try {
        // Bun does not support filtering by production packages yet.
        // https://github.com/oven-sh/bun/issues/8283
        return (await spawn(agentExecPath!, ['pm', 'ls', '--all'], { cwd }))
          .stdout
      } catch {}
      return ''
    },
    async npm(agentExecPath: string, cwd: string) {
      return await npmQuery(agentExecPath, cwd)
    },
    async pnpm(
      agentExecPath: string,
      cwd: string,
      options: AgentListDepsOptions
    ) {
      const { npmExecPath } = <AgentListDepsOptions>{
        __proto__: null,
        ...options
      }
      if (npmExecPath && npmExecPath !== 'npm') {
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
    async vlt(agentExecPath: string, cwd: string) {
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
    async 'yarn/berry'(agentExecPath: string, cwd: string) {
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
    async 'yarn/classic'(agentExecPath: string, cwd: string) {
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
    bun: matchHumanStdout,
    npm: matchQueryStdout,
    pnpm: matchQueryStdout,
    vlt: matchQueryStdout,
    'yarn/berry': matchHumanStdout,
    'yarn/classic': matchHumanStdout
  }
})()

function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number
) {
  return `${verb} ${overrideCount} Socket.dev optimized overrides${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', workspaceCount)}` : ''}`
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
  if (agent === 'pnpm') {
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
    agent === 'pnpm' &&
    npmExecPath === 'npm' &&
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
  const thingScanner = isLockScanned
    ? lockIncludesByAgent[agent]
    : depsIncludesByAgent[agent]
  const depEntries = getDependencyEntries(pkgJson)

  const overridesDataObjects = <GetOverridesResult[]>[]
  if (pkgJson['private'] || isWorkspace) {
    overridesDataObjects.push(getOverridesDataByAgent[agent](pkgJson))
  } else {
    overridesDataObjects.push(
      getOverridesDataByAgent.npm(pkgJson),
      getOverridesDataByAgent['yarn/classic'](pkgJson)
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
        if (overrideExists || thingScanner(thingToScan, origPkgName)) {
          const oldSpec = overrideExists ? overrides[origPkgName] : undefined
          const depAlias = depAliasMap.get(origPkgName)
          const regSpecStartsLike = `npm:${regPkgName}@`
          let newSpec = `${regSpecStartsLike}^${pin ? version : major}`
          let thisVersion = version
          if (depAlias && type === 'npm') {
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
            if (workspaceName) {
              const addedOrUpdatedIn = overrideExists
                ? 'updatedInWorkspaces'
                : 'addedInWorkspaces'
              state[addedOrUpdatedIn].add(workspaceName)
            }
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
    if (agent === 'vlt') {
      console.error(
        `✖️ ${COMMAND_TITLE}: ${agent} does not support overrides. Soon, though ⚡`
      )
      return
    }
    const lockName = lockPath ? path.basename(lockPath) : 'lock file'
    if (lockSrc === undefined) {
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
    if (prod && (agent === 'bun' || agent === 'yarn/berry')) {
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
    const spinner = yoctoSpinner({ text: 'Socket optimizing...' })
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
    const isNpm = agent === 'npm'
    if (isNpm || pkgJsonChanged) {
      // Always update package-lock.json until the npm overrides PR lands:
      // https://github.com/npm/cli/pull/7025
      spinner.start(`Updating ${lockName}...`)
      try {
        if (isNpm) {
          const wrapperPath = path.join(distPath, 'npm-cli.js')
          await spawn(
            process.execPath,
            [
              wrapperPath,
              'install',
              '--no-audit',
              '--no-fund',
              '--no-progress',
              '--quiet'
            ],
            {
              stdio: 'ignore',
              env: {
                ...process.env,
                [UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE]: '1'
              }
            }
          )
        } else {
          // All package managers support the "install" command.
          await spawn(agentExecPath, ['install'], { stdio: 'ignore' })
        }
        spinner.stop()
        if (isNpm) {
          console.log(
            `💡 Re-run ${COMMAND_TITLE} whenever ${lockName} changes.\n   This can be skipped once npm ships ${NPM_OVERRIDE_PR_URL}.`
          )
        }
      } catch {
        spinner.error(
          `${COMMAND_TITLE}: ${agent} install failed to update ${lockName}`
        )
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
