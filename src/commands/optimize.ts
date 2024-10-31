import fs from 'fs/promises'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import EditablePackageJson from '@npmcli/package-json'
import { getManifestData } from '@socketsecurity/registry'
import meow from 'meow'
import npa from 'npm-package-arg'
import ora from 'ora'
import pacote from 'pacote'
import semver from 'semver'
import { glob as tinyGlob } from 'tinyglobby'
import { parse as yamlParse } from 'yaml'

import { commonFlags } from '../flags'
import { printFlagList } from '../utils/formatting'
import { existsSync } from '../utils/fs'
import { hasOwn } from '../utils/objects'
import { detect } from '../utils/package-manager-detector'
import { pEach } from '../utils/promises'
import { escapeRegExp } from '../utils/regexps'
import { toSortedObject } from '../utils/sorts'
import { isNonEmptyString } from '../utils/strings'

import type { Content as PackageJsonContent } from '@npmcli/package-json'
import type { ManifestEntry } from '@socketsecurity/registry'
import type { PacoteOptions } from 'pacote'
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  AgentPlusBun,
  StringKeyValueObject
} from '../utils/package-manager-detector'

const COMMAND_TITLE = 'Socket Optimize'
const OVERRIDES_FIELD_NAME = 'overrides'
const PNPM_WORKSPACE = 'pnpm-workspace'
const RESOLUTIONS_FIELD_NAME = 'resolutions'

const distPath = __dirname
const manifestNpmOverrides = getManifestData('npm')!
const packumentCache = new Map()

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkgJson: PackageJsonContent) => GetOverridesResult
type GetOverridesResult = {
  type: Agent
  overrides: Overrides
}

const getOverridesDataByAgent: Record<AgentPlusBun, GetOverrides> = {
  bun(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn', overrides }
  },
  // npm overrides documentation:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
  npm(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.overrides ?? {}
    return { type: 'npm', overrides }
  },
  // pnpm overrides documentation:
  // https://pnpm.io/package_json#pnpmoverrides
  pnpm(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.pnpm?.overrides ?? {}
    return { type: 'pnpm', overrides }
  },
  // Yarn resolutions documentation:
  // https://yarnpkg.com/configuration/manifest#resolutions
  yarn(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn', overrides }
  }
}

type AgentLockIncludesFn = (lockSrc: string, name: string) => boolean

const lockIncludesByAgent: Record<AgentPlusBun, AgentLockIncludesFn> = (() => {
  const yarn = (lockSrc: string, name: string) => {
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
    bun: yarn,
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
    yarn
  }
})()

type AgentModifyManifestFn = (
  pkgJson: EditablePackageJson,
  overrides: Overrides
) => void

const updateManifestByAgent: Record<AgentPlusBun, AgentModifyManifestFn> = {
  bun(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      [RESOLUTIONS_FIELD_NAME]: <PnpmOrYarnOverrides>overrides
    })
  },
  npm(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      [OVERRIDES_FIELD_NAME]: overrides
    })
  },
  pnpm(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      pnpm: {
        ...(<object>pkgJson.content['pnpm']),
        [OVERRIDES_FIELD_NAME]: overrides
      }
    })
  },
  yarn(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      [RESOLUTIONS_FIELD_NAME]: <PnpmOrYarnOverrides>overrides
    })
  }
}

type AgentListDepsFn = (
  agentExecPath: string,
  cwd: string,
  rootPath: string
) => Promise<string>

const lsByAgent: Record<AgentPlusBun, AgentListDepsFn> = {
  async bun(agentExecPath: string, cwd: string, _rootPath: string) {
    try {
      return (await spawn(agentExecPath, ['pm', 'ls', '--all'], { cwd })).stdout
    } catch {}
    return ''
  },
  async npm(agentExecPath: string, cwd: string, rootPath: string) {
    try {
      ;(
        await spawn(
          agentExecPath,
          ['ls', '--parseable', '--include', 'prod', '--all'],
          { cwd }
        )
      ).stdout
        .replaceAll(cwd, '')
        .replaceAll(rootPath, '')
    } catch {}
    return ''
  },
  async pnpm(agentExecPath: string, cwd: string, rootPath: string) {
    try {
      return (
        await spawn(
          agentExecPath,
          ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
          { cwd }
        )
      ).stdout
        .replaceAll(cwd, '')
        .replaceAll(rootPath, '')
    } catch {}
    return ''
  },
  async yarn(agentExecPath: string, cwd: string, _rootPath: string) {
    try {
      return (
        await spawn(agentExecPath, ['info', '--recursive', '--name-only'], {
          cwd
        })
      ).stdout
    } catch {}
    try {
      return (await spawn(agentExecPath, ['list', '--prod'], { cwd })).stdout
    } catch {}
    return ''
  }
}

type AgentDepsIncludesFn = (stdout: string, name: string) => boolean

const depsIncludesByAgent: Record<AgentPlusBun, AgentDepsIncludesFn> = {
  bun: (stdout: string, name: string) => stdout.includes(name),
  npm: (stdout: string, name: string) => stdout.includes(name),
  pnpm: (stdout: string, name: string) => stdout.includes(name),
  yarn: (stdout: string, name: string) => stdout.includes(name)
}

function getDependencyEntries(pkgJson: PackageJsonContent) {
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

async function getWorkspaces(
  agent: AgentPlusBun,
  pkgPath: string,
  pkgJson: PackageJsonContent
): Promise<string[] | undefined> {
  if (agent !== 'pnpm') {
    return Array.isArray(pkgJson['workspaces'])
      ? <string[]>pkgJson['workspaces'].filter(isNonEmptyString)
      : undefined
  }
  for (const workspacePath of [
    path.join(pkgPath!, `${PNPM_WORKSPACE}.yaml`),
    path.join(pkgPath!, `${PNPM_WORKSPACE}.yml`)
  ]) {
    if (existsSync(workspacePath)) {
      let packages
      try {
        // eslint-disable-next-line no-await-in-loop
        packages = yamlParse(await fs.readFile(workspacePath, 'utf8'))?.packages
      } catch {}
      if (Array.isArray(packages)) {
        return packages.filter(isNonEmptyString)
      }
    }
  }
  return undefined
}

function workspaceToGlobPattern(workspace: string): string {
  const { length } = workspace
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
  agent: AgentPlusBun
  agentExecPath: string
  lockSrc: string
  manifestEntries: ManifestEntry[]
  pkgJson?: EditablePackageJson | undefined
  pkgPath: string
  pin: boolean
  rootPath: string
}

type AddOverridesState = {
  added: Set<string>
  updated: Set<string>
}

async function addOverrides(
  {
    agent,
    agentExecPath,
    lockSrc,
    manifestEntries,
    pkgJson: editablePkgJson,
    pkgPath,
    pin,
    rootPath
  }: AddOverridesConfig,
  state: AddOverridesState = {
    added: new Set(),
    updated: new Set()
  }
): Promise<AddOverridesState> {
  if (editablePkgJson === undefined) {
    editablePkgJson = await EditablePackageJson.load(pkgPath)
  }
  const pkgJson: Readonly<PackageJsonContent> = editablePkgJson.content
  const isRoot = pkgPath === rootPath
  const thingToScan = isRoot
    ? lockSrc
    : await lsByAgent[agent](agentExecPath, pkgPath, rootPath)
  const thingScanner = isRoot
    ? lockIncludesByAgent[agent]
    : depsIncludesByAgent[agent]
  const depEntries = getDependencyEntries(pkgJson)
  const workspaces = await getWorkspaces(agent, pkgPath, pkgJson)
  const isWorkspace = !!workspaces
  const overridesDataObjects = <GetOverridesResult[]>[]
  if (pkgJson['private'] || isWorkspace) {
    overridesDataObjects.push(getOverridesDataByAgent[agent](pkgJson))
  } else {
    overridesDataObjects.push(
      getOverridesDataByAgent['npm'](pkgJson),
      getOverridesDataByAgent['yarn'](pkgJson)
    )
  }
  const spinner = isRoot
    ? ora('Fetching override manifests...').start()
    : undefined
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
        }
        depAliasMap.set(origPkgName, {
          id: pkgSpec,
          version: thisVersion
        })
      }
    }
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(overridesDataObjects, 3, async ({ overrides, type }) => {
      const overrideExists = hasOwn(overrides, origPkgName)
      if (overrideExists || thingScanner(thingToScan, origPkgName)) {
        const oldSpec = overrideExists ? overrides[origPkgName] : undefined
        const depAlias = depAliasMap.get(origPkgName)
        const regSpecStartsLike = `npm:${regPkgName}@`
        let newSpec = `${regSpecStartsLike}${pin ? version : `^${major}`}`
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
                  : ((await fetchPackageManifest(thisSpec))?.version ?? version)
            }
            newSpec = `${regSpecStartsLike}${pin ? thisVersion : `^${semver.major(thisVersion)}`}`
          } else {
            newSpec = oldSpec
          }
        }
        if (newSpec !== oldSpec) {
          if (overrideExists) {
            state.updated.add(regPkgName)
          } else {
            state.added.add(regPkgName)
          }
          overrides[origPkgName] = newSpec
        }
      }
    })
  })
  if (workspaces) {
    const wsPkgJsonPaths = await tinyGlob(
      workspaces.map(workspaceToGlobPattern),
      {
        absolute: true,
        cwd: pkgPath!
      }
    )
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(wsPkgJsonPaths, 3, async wsPkgJsonPath => {
      const { added, updated } = await addOverrides({
        agent,
        agentExecPath,
        lockSrc,
        manifestEntries,
        pin,
        pkgPath: path.dirname(wsPkgJsonPath),
        rootPath
      })
      for (const regPkgName of added) {
        state.added.add(regPkgName)
      }
      for (const regPkgName of updated) {
        state.updated.add(regPkgName)
      }
    })
  }
  spinner?.stop()
  if (state.added.size || state.updated.size) {
    editablePkgJson.update(<PackageJsonContent>Object.fromEntries(depEntries))
    for (const { overrides, type } of overridesDataObjects) {
      updateManifestByAgent[type](editablePkgJson, toSortedObject(overrides))
    }
    await editablePkgJson.save()
  }
  return state
}

type FetchPackageManifestOptions = {
  signal?: AbortSignal
}

async function fetchPackageManifest(
  pkgNameOrId: string,
  options?: FetchPackageManifestOptions
) {
  const pacoteOptions = <PacoteOptions & { signal?: AbortSignal }>{
    ...options,
    packumentCache,
    preferOffline: true
  }
  const { signal } = pacoteOptions
  if (signal?.aborted) {
    return null
  }
  let result
  try {
    result = await pacote.manifest(pkgNameOrId, pacoteOptions)
  } catch {}
  if (signal?.aborted) {
    return null
  }
  return result
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
    const { pin } = commandContext
    const cwd = process.cwd()
    const {
      agent,
      agentExecPath,
      lockSrc,
      lockPath,
      minimumNodeVersion,
      pkgJson,
      pkgPath,
      supported
    } = await detect({
      cwd,
      onUnknown(pkgManager: string | undefined) {
        console.log(
          `⚠️ ${COMMAND_TITLE}: Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`
        )
      }
    })
    if (!supported) {
      console.log(
        `✘ ${COMMAND_TITLE}: No supported Node or browser range detected`
      )
      return
    }
    const lockName = lockPath ? path.basename(lockPath) : 'lock file'
    if (lockSrc === undefined) {
      console.log(`✘ ${COMMAND_TITLE}: No ${lockName} found`)
      return
    }
    if (pkgPath === undefined) {
      console.log(`✘ ${COMMAND_TITLE}: No package.json found`)
      return
    }
    if (lockPath && path.relative(cwd, lockPath).startsWith('.')) {
      console.log(
        `⚠️ ${COMMAND_TITLE}: Package ${lockName} found at ${lockPath}`
      )
    }
    const state: AddOverridesState = {
      added: new Set(),
      updated: new Set()
    }
    if (lockSrc) {
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
          pin,
          pkgJson,
          pkgPath,
          rootPath: pkgPath
        },
        state
      )
    }
    const pkgJsonChanged = state.added.size > 0 || state.updated.size > 0
    if (state.updated.size > 0) {
      console.log(
        `Updated ${state.updated.size} Socket.dev optimized overrides ${state.added.size ? '.' : '🚀'}`
      )
    }
    if (state.added.size > 0) {
      console.log(`Added ${state.added.size} Socket.dev optimized overrides 🚀`)
    }
    if (!pkgJsonChanged) {
      console.log('Congratulations! Already Socket.dev optimized 🎉')
    }
    const isNpm = agent === 'npm'
    if (isNpm || pkgJsonChanged) {
      // Always update package-lock.json until the npm overrides PR lands:
      // https://github.com/npm/cli/pull/7025
      const spinner = ora(`Updating ${lockName}...`).start()
      try {
        if (isNpm) {
          const wrapperPath = path.join(distPath, 'npm-cli.js')
          await spawn(process.execPath, [wrapperPath, 'install'], {
            stdio: 'pipe',
            env: {
              ...process.env,
              UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: '1'
            }
          })
        } else {
          await spawn(agentExecPath, ['install'], { stdio: 'pipe' })
        }
        spinner.stop()
        if (isNpm) {
          console.log(
            `💡 Re-run ${COMMAND_TITLE} whenever ${lockName} changes.\n   This can be skipped once npm ships https://github.com/npm/cli/pull/7025.`
          )
        }
      } catch {
        spinner.stop()
        console.log(
          `✘ ${COMMAND_TITLE}: ${agent} install failed to update ${lockName}`
        )
      }
    }
  }
}

// Internal functions

type CommandContext = {
  pin: boolean
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
  const { help, pin } = cli.flags
  if (help) {
    cli.showHelp()
    return
  }
  return <CommandContext>{
    pin
  }
}
