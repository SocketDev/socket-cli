import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import EditablePackageJson from '@npmcli/package-json'
import { getManifestData } from '@socketsecurity/registry'
import meow from 'meow'
import npmPackageArg from 'npm-package-arg'
import ora from 'ora'
import pacote from 'pacote'
import semver from 'semver'

import { commonFlags } from '../flags'
import { printFlagList } from '../utils/formatting'
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
  StringKeyValueObject
} from '../utils/package-manager-detector'

const distPath = __dirname

const COMMAND_TITLE = 'Socket Optimize'
const OVERRIDES_FIELD_NAME = 'overrides'
const RESOLUTIONS_FIELD_NAME = 'resolutions'

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

const getOverridesDataByAgent: Record<Agent, GetOverrides> = {
  // npm overrides documentation:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
  npm: (pkgJson: PackageJsonContent) => {
    const overrides = (pkgJson as any)?.overrides ?? {}
    return { type: 'npm', overrides }
  },
  // pnpm overrides documentation:
  // https://pnpm.io/package_json#pnpmoverrides
  pnpm: (pkgJson: PackageJsonContent) => {
    const overrides = (pkgJson as any)?.pnpm?.overrides ?? {}
    return { type: 'pnpm', overrides }
  },
  // Yarn resolutions documentation:
  // https://yarnpkg.com/configuration/manifest#resolutions
  yarn: (pkgJson: PackageJsonContent) => {
    const overrides = (pkgJson as any)?.resolutions ?? {}
    return { type: 'yarn', overrides }
  }
}

type LockIncludes = (lockSrc: string, name: string) => boolean

const lockIncludesByAgent: Record<Agent, LockIncludes> = {
  npm: (lockSrc: string, name: string) => {
    // Detects the package name in the following cases:
    //   "name":
    return lockSrc.includes(`"${name}":`)
  },
  pnpm: (lockSrc: string, name: string) => {
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
  yarn: (lockSrc: string, name: string) => {
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
}

type ModifyManifest = (
  editablePkgJson: EditablePackageJson,
  overrides: Overrides
) => void

const updateManifestByAgent: Record<Agent, ModifyManifest> = (<any>{
  __proto__: null,
  npm(editablePkgJson: EditablePackageJson, overrides: Overrides) {
    editablePkgJson.update({
      __proto__: null,
      [OVERRIDES_FIELD_NAME]: overrides
    })
  },
  pnpm(editablePkgJson: EditablePackageJson, overrides: Overrides) {
    editablePkgJson.update({
      pnpm: {
        __proto__: null,
        ...(<object>editablePkgJson.content['pnpm']),
        [OVERRIDES_FIELD_NAME]: overrides
      }
    })
  },
  yarn(editablePkgJson: EditablePackageJson, overrides: PnpmOrYarnOverrides) {
    editablePkgJson.update({
      __proto__: null,
      [RESOLUTIONS_FIELD_NAME]: overrides
    })
  }
}) as Record<Agent, ModifyManifest>

type AddOverridesConfig = {
  agent: Agent
  isPrivate: boolean
  isWorkspace: boolean
  lockIncludes: LockIncludes
  lockSrc: string
  manifestEntries: ManifestEntry[]
  pkgJsonPath: string
  pin: boolean
}

type AddOverridesState = {
  added: Set<string>
  updated: Set<string>
}

async function addOverrides(
  {
    agent,
    isPrivate,
    isWorkspace,
    lockSrc,
    lockIncludes,
    manifestEntries,
    pkgJsonPath,
    pin
  }: AddOverridesConfig,
  state: AddOverridesState
): Promise<AddOverridesState> {
  const editablePkgJson = await EditablePackageJson.load(
    path.dirname(pkgJsonPath)
  )
  const {
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies
  } = editablePkgJson.content
  const depEntries = <[string, NonNullable<typeof dependencies>][]>[
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
  const overridesDataObjects = <GetOverridesResult[]>[]
  if (isPrivate || isWorkspace) {
    overridesDataObjects.push(
      getOverridesDataByAgent[agent](editablePkgJson.content)
    )
  } else {
    overridesDataObjects.push(
      getOverridesDataByAgent['npm'](editablePkgJson.content),
      getOverridesDataByAgent['yarn'](editablePkgJson.content)
    )
  }
  const depAliasMap = new Map<string, { id: string; version: string }>()
  const spinner = ora(`Fetching override manifests...`).start()
  // Chunk package names to process them in parallel 3 at a time.
  await pEach(manifestEntries, 3, async ({ 1: data }) => {
    const { name: regPkgName, package: origPkgName, version } = data
    for (const { 1: depObj } of depEntries) {
      let pkgSpec = depObj[origPkgName]
      if (pkgSpec) {
        let thisVersion = version
        // Add package aliases for direct dependencies to avoid npm EOVERRIDE errors.
        // https://docs.npmjs.com/cli/v8/using-npm/package-spec#aliases
        const specStartsWith = `npm:${regPkgName}@`
        const existingVersion = pkgSpec.startsWith(specStartsWith)
          ? (semver.coerce(npmPackageArg(pkgSpec).rawSpec)?.version ?? '')
          : ''
        if (existingVersion) {
          thisVersion = existingVersion
        } else {
          pkgSpec = `${specStartsWith}^${version}`
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
      if (overrideExists || lockIncludes(lockSrc, origPkgName)) {
        // With npm one may not set an override for a package that one directly
        // depends on unless both the dependency and the override itself share
        // the exact same spec. To make this limitation easier to deal with,
        // overrides may also be defined as a reference to a spec for a direct
        // dependency by prefixing the name of the package to match the version
        // of with a $.
        // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides
        const oldSpec = overrides[origPkgName]
        const depAlias = depAliasMap.get(origPkgName)
        const thisVersion =
          overrideExists && isNonEmptyString(oldSpec)
            ? ((
                await fetchPackageManifest(
                  oldSpec.startsWith('$') ? (depAlias?.id ?? oldSpec) : oldSpec
                )
              )?.version ?? version)
            : version
        const newSpec =
          depAlias && type === 'npm'
            ? `$${origPkgName}`
            : `npm:${regPkgName}@^${pin ? thisVersion : semver.major(thisVersion)}`
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
  spinner.stop()
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
      isPrivate,
      isWorkspace,
      lockSrc,
      lockPath,
      minimumNodeVersion,
      pkgJsonPath,
      pkgJson,
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
    if (pkgJson === undefined) {
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
      const lockIncludes =
        agent === 'bun' ? lockIncludesByAgent.yarn : lockIncludesByAgent[agent]
      const nodeRange = `>=${minimumNodeVersion}`
      const manifestEntries = manifestNpmOverrides.filter(({ 1: data }) =>
        semver.satisfies(semver.coerce(data.engines.node)!, nodeRange)
      )
      await addOverrides(
        {
          agent: agent === 'bun' ? 'yarn' : agent,
          isPrivate,
          isWorkspace,
          lockIncludes,
          lockSrc,
          manifestEntries,
          pin,
          pkgJsonPath
        },
        state
      )
    }
    const pkgJsonChanged = state.updated.size > 0 || state.updated.size > 0
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
