import fs from 'fs/promises'
import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import EditablePackageJson from '@npmcli/package-json'
import { getManifestData } from '@socketsecurity/registry'
//import cacache from 'cacache'
import meow from 'meow'
import npa from 'npm-package-arg'
import ora from 'ora'
import pacote from 'pacote'
import semver from 'semver'
import { glob as tinyGlob } from 'tinyglobby'
import { parse as yamlParse } from 'yaml'

//import { packumentCache, pacoteCachePath } from '../constants'
import { packumentCache } from '../constants'
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
import type { Ora } from 'ora'
import type { PacoteOptions } from 'pacote'
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  StringKeyValueObject
} from '../utils/package-manager-detector'

const COMMAND_TITLE = 'Socket Optimize'
const OVERRIDES_FIELD_NAME = 'overrides'
const PNPM_WORKSPACE = 'pnpm-workspace'
const RESOLUTIONS_FIELD_NAME = 'resolutions'

const distPath = __dirname
const manifestNpmOverrides = getManifestData('npm')!

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkgJson: PackageJsonContent) => GetOverridesResult
type GetOverridesResult = {
  type: Agent
  overrides: Overrides
}

const getOverridesDataByAgent: Record<Agent, GetOverrides> = {
  bun(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/berry', overrides }
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
  'yarn/berry'(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/berry', overrides }
  },
  // Yarn resolutions documentation:
  // https://classic.yarnpkg.com/en/docs/selective-version-resolutions
  'yarn/classic'(pkgJson: PackageJsonContent) {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn/classic', overrides }
  }
}

type AgentLockIncludesFn = (lockSrc: string, name: string) => boolean

const lockIncludesByAgent: Record<Agent, AgentLockIncludesFn> = (() => {
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
    'yarn/berry': yarn,
    'yarn/classic': yarn
  }
})()

type AgentModifyManifestFn = (
  pkgJson: EditablePackageJson,
  overrides: Overrides
) => void

const updateManifestByAgent: Record<Agent, AgentModifyManifestFn> = {
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
  'yarn/berry'(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      [RESOLUTIONS_FIELD_NAME]: <PnpmOrYarnOverrides>overrides
    })
  },
  'yarn/classic'(pkgJson: EditablePackageJson, overrides: Overrides) {
    pkgJson.update({
      [RESOLUTIONS_FIELD_NAME]: <PnpmOrYarnOverrides>overrides
    })
  }
}

type AgentListDepsOptions = {
  npmExecPath?: string
  rootPath?: string
}
type AgentListDepsFn = (
  agentExecPath: string,
  cwd: string,
  options?: AgentListDepsOptions
) => Promise<string>

const lsByAgent = (() => {
  function cleanupParseable(
    stdout: string,
    cwd: string,
    rootPath?: string
  ): string {
    stdout = stdout.trim()
    stdout = stdout.replaceAll(cwd, '')
    if (rootPath && rootPath !== cwd) {
      stdout = stdout.replaceAll(rootPath, '')
    }
    return stdout.replaceAll('\\', '/')
  }

  async function npmLs(npmExecPath: string, cwd: string, rootPath?: string) {
    return cleanupParseable(
      (
        await spawn(
          npmExecPath,
          ['ls', '--parseable', '--omit', 'dev', '--all'],
          { cwd }
        )
      ).stdout,
      cwd,
      rootPath
    )
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
    async npm(
      agentExecPath: string,
      cwd: string,
      options: AgentListDepsOptions
    ) {
      const { rootPath } = <AgentListDepsOptions>{ __proto__: null, ...options }
      try {
        return await npmLs(agentExecPath, cwd, rootPath)
      } catch {}
      return ''
    },
    async pnpm(
      agentExecPath: string,
      cwd: string,
      options: AgentListDepsOptions
    ) {
      const { npmExecPath, rootPath } = <AgentListDepsOptions>{
        __proto__: null,
        ...options
      }
      let stdout = ''
      if (npmExecPath && npmExecPath !== 'npm') {
        try {
          stdout = await npmLs(npmExecPath, cwd, rootPath)
        } catch (e: any) {
          if (e?.stderr?.includes('code ELSPROBLEMS')) {
            stdout = e?.stdout
          }
        }
      } else {
        try {
          stdout = cleanupParseable(
            (
              await spawn(
                agentExecPath,
                ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
                { cwd }
              )
            ).stdout,
            cwd,
            rootPath
          )
        } catch {}
      }
      return stdout
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

const depsIncludesByAgent: Record<Agent, AgentDepsIncludesFn> = {
  bun: (stdout: string, name: string) => stdout.includes(` ${name}@`),
  npm: (stdout: string, name: string) => stdout.includes(`/${name}\n`),
  pnpm: (stdout: string, name: string) => stdout.includes(`/${name}\n`),
  'yarn/berry': (stdout: string, name: string) => stdout.includes(` ${name}@`),
  'yarn/classic': (stdout: string, name: string) => stdout.includes(` ${name}@`)
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
  agent: Agent,
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
  spinner?: Ora | undefined
  updated: Set<string>
  warnedPnpmWorkspaceRequiresNpm: boolean
}

function createAddOverridesState(initials?: any): AddOverridesState {
  return {
    added: new Set(),
    spinner: undefined,
    updated: new Set(),
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
    editablePkgJson = await EditablePackageJson.load(pkgPath)
  }
  const { spinner } = state
  const pkgJson: Readonly<PackageJsonContent> = editablePkgJson.content
  const isRoot = pkgPath === rootPath
  const isLockScanned = isRoot && !prod
  const relPath = path.relative(rootPath, pkgPath)
  const workspaces = await getWorkspaces(agent, pkgPath, pkgJson)
  const isWorkspace = !!workspaces
  if (
    isWorkspace &&
    agent === 'pnpm' &&
    npmExecPath === 'npm' &&
    !state.warnedPnpmWorkspaceRequiresNpm
  ) {
    state.warnedPnpmWorkspaceRequiresNpm = true
    console.log(
      `⚠️ ${COMMAND_TITLE}: pnpm workspace support requires \`npm ls\`, falling back to \`pnpm list\``
    )
  }
  const thingToScan = isLockScanned
    ? lockSrc
    : await lsByAgent[agent](agentExecPath, pkgPath, { npmExecPath, rootPath })
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
    spinner.text = `Adding overrides${relPath ? ` to ${relPath}` : ''}...`
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
                  : ((await fetchPackageManifest(thisSpec))?.version ?? version)
            }
            newSpec = `${regSpecStartsLike}^${pin ? thisVersion : semver.major(thisVersion)}`
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
        cwd: pkgPath!,
        ignore: ['**/node_modules/**', '**/bower_components/**']
      }
    )
    // Chunk package names to process them in parallel 3 at a time.
    await pEach(wsPkgJsonPaths, 3, async wsPkgJsonPath => {
      const { added, updated } = await addOverrides(
        {
          agent,
          agentExecPath,
          lockSrc,
          manifestEntries,
          npmExecPath,
          pin,
          pkgPath: path.dirname(wsPkgJsonPath),
          prod,
          rootPath
        },
        createAddOverridesState({ spinner })
      )
      for (const regPkgName of added) {
        state.added.add(regPkgName)
      }
      for (const regPkgName of updated) {
        state.updated.add(regPkgName)
      }
    })
  }
  if (state.added.size > 0 || state.updated.size > 0) {
    editablePkgJson.update(<PackageJsonContent>Object.fromEntries(depEntries))
    for (const { overrides, type } of overridesDataObjects) {
      updateManifestByAgent[type](editablePkgJson, toSortedObject(overrides))
    }
    await editablePkgJson.save()
  }
  return state
}

// type ExtractOptions = pacote.Options & {
//   tmpPrefix?: string
//   [key: string]: any
// }

// async function extractPackage(pkgNameOrId: string, options: ExtractOptions | undefined, callback: (tmpDirPath: string) => any) {
//   if (arguments.length === 2 && typeof options === 'function') {
//     callback = options
//     options = undefined
//   }
//   const { tmpPrefix, ...extractOptions } = { __proto__: null, ...options }
//   // cacache.tmp.withTmp DOES return a promise.
//   await cacache.tmp.withTmp(
//     pacoteCachePath,
//     { tmpPrefix },
//     // eslint-disable-next-line @typescript-eslint/no-misused-promises
//     async tmpDirPath => {
//       await pacote.extract(pkgNameOrId, tmpDirPath, {
//         __proto__: null,
//         packumentCache,
//         preferOffline: true,
//         ...<Omit<typeof extractOptions, '__proto__'>>extractOptions
//       })
//       await callback(tmpDirPath)
//     }
//   )
// }

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
    if (lockSrc.trim() === '') {
      console.log(`✘ ${COMMAND_TITLE}: ${lockName} is empty`)
      return
    }
    if (pkgPath === undefined) {
      console.log(`✘ ${COMMAND_TITLE}: No package.json found`)
      return
    }
    if (prod && (agent === 'bun' || agent === 'yarn/berry')) {
      console.log(
        `✘ ${COMMAND_TITLE}: --prod not supported for ${agent}${agentVersion ? `@${agentVersion.toString()}` : ''}`
      )
      return
    }
    if (lockPath && path.relative(cwd, lockPath).startsWith('.')) {
      console.log(
        `⚠️ ${COMMAND_TITLE}: Package ${lockName} found at ${lockPath}`
      )
    }
    const spinner = ora('Socket optimizing...')
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
    const pkgJsonChanged = state.added.size > 0 || state.updated.size > 0
    if (pkgJsonChanged) {
      if (state.updated.size > 0) {
        console.log(
          `Updated ${state.updated.size} Socket.dev optimized overrides ${state.added.size ? '.' : '🚀'}`
        )
      }
      if (state.added.size > 0) {
        console.log(
          `Added ${state.added.size} Socket.dev optimized overrides 🚀`
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
            [wrapperPath, 'install', '--no-audit', '--no-fund'],
            {
              stdio: 'pipe',
              env: {
                ...process.env,
                UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: '1'
              }
            }
          )
        } else {
          // All package managers support the "install" command.
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
