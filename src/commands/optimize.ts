import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import EditablePackageJson from '@npmcli/package-json'
import { getManifestData } from '@socketsecurity/registry'
import meow from 'meow'
import ora from 'ora'
import semver from 'semver'

import { printFlagList } from '../utils/formatting'
import { hasOwn } from '../utils/objects'
import { detect } from '../utils/package-manager-detector'
import { escapeRegExp } from '../utils/regexps'
import { toSortedObject } from '../utils/sorts'

import type { Content as PackageJsonContent } from '@npmcli/package-json'
import type { ManifestEntry } from '@socketsecurity/registry'
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
  lockSrc: string
  lockIncludes: LockIncludes
  manifestEntries: ManifestEntry[]
  pkgJsonPath: string
  pkgJsonStr: string
  pkgJson: PackageJsonContent
}

type AddOverridesState = {
  output: string
  packageNames: Set<string>
}

async function addOverrides(
  {
    agent,
    isPrivate,
    isWorkspace,
    lockSrc,
    lockIncludes,
    manifestEntries,
    pkgJsonPath
  }: AddOverridesConfig,
  aoState: AddOverridesState
): Promise<AddOverridesState> {
  const { packageNames } = aoState
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
  const aliasMap = new Map<string, string>()
  for (const { 1: data } of manifestEntries) {
    const { name: regPkgName, package: origPkgName, version } = data
    for (const { 1: depObj } of depEntries) {
      let pkgSpec = depObj[origPkgName]
      if (pkgSpec) {
        // Add package aliases for direct dependencies to avoid npm EOVERRIDE errors.
        // https://docs.npmjs.com/cli/v8/using-npm/package-spec#aliases
        const overrideSpecPrefix = `npm:${regPkgName}@`
        if (!pkgSpec.startsWith(overrideSpecPrefix)) {
          aliasMap.set(regPkgName, pkgSpec)
        } else {
          packageNames.add(regPkgName)
          pkgSpec = `${overrideSpecPrefix}^${version}`
          depObj[origPkgName] = pkgSpec
        }
        aliasMap.set(origPkgName, pkgSpec)
      }
    }
    for (const { overrides, type } of overridesDataObjects) {
      if (
        !hasOwn(overrides, origPkgName) &&
        lockIncludes(lockSrc, origPkgName)
      ) {
        packageNames.add(regPkgName)
        overrides[origPkgName] =
          // With npm you may not set an override for a package that you directly
          // depend on unless both the dependency and the override itself share
          // the exact same spec. To make this limitation easier to deal with,
          // overrides may also be defined as a reference to a spec for a direct
          // dependency by prefixing the name of the package you wish the version
          // to match with a $.
          // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#overrides
          (type === 'npm' && aliasMap.has(origPkgName) && `$${origPkgName}`) ||
          `npm:${regPkgName}@^${semver.major(version)}`
      }
    }
  }
  if (packageNames.size) {
    editablePkgJson.update(<PackageJsonContent>Object.fromEntries(depEntries))
    for (const { overrides, type } of overridesDataObjects) {
      updateManifestByAgent[type](editablePkgJson, toSortedObject(overrides))
    }
    await editablePkgJson.save()
  }
  return aoState
}

export const optimize: CliSubcommand = {
  description: 'Optimize dependencies with @socketregistry overrides',
  async run(argv, importMeta, { parentName }) {
    const commandContext = setupCommand(
      `${parentName} dependency optimize`,
      optimize.description,
      argv,
      importMeta
    )
    if (commandContext) {
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
        pkgJsonStr,
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

      const aoState: AddOverridesState = {
        output: pkgJsonStr!,
        packageNames: new Set()
      }
      if (lockSrc) {
        const lockIncludes =
          agent === 'bun'
            ? lockIncludesByAgent.yarn
            : lockIncludesByAgent[agent]
        const nodeRange = `>=${minimumNodeVersion}`
        const manifestEntries = manifestNpmOverrides.filter(({ 1: data }) =>
          semver.satisfies(semver.coerce(data.engines.node)!, nodeRange)
        )
        await addOverrides(
          <AddOverridesConfig>{
            __proto__: null,
            agent: agent === 'bun' ? 'yarn' : agent,
            isPrivate,
            isWorkspace,
            lockIncludes,
            lockSrc,
            manifestEntries,
            pkgJsonPath,
            pkgJsonStr,
            pkgJson
          },
          aoState
        )
      }
      const { size: count } = aoState.packageNames
      if (count) {
        console.log(`Added ${count} Socket.dev optimized overrides 🚀`)
      } else {
        console.log('Congratulations! Already Socket.dev optimized 🎉')
      }

      const isNpm = agent === 'npm'
      if (isNpm || count) {
        // Always update package-lock.json until the npm overrides PR lands:
        // https://github.com/npm/cli/pull/7025
        const spinner = ora(`Updating ${lockName}...`).start()
        try {
          if (isNpm) {
            const wrapperPath = path.join(distPath, 'npm-cli.js')
            await spawn(process.execPath, [wrapperPath, 'install'], {
              stdio: 'pipe',
              env: (<unknown>{
                __proto__: null,
                ...process.env,
                UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: '1'
              }) as NodeJS.ProcessEnv
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
}

// Internal functions

type CommandContext = {
  outputJson: boolean
  outputMarkdown: boolean
  limit: number
  offset: number
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): CommandContext | undefined {
  const flags: { [key: string]: any } = {}

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

  const {
    json: outputJson,
    markdown: outputMarkdown,
    limit,
    offset
  } = cli.flags

  return <CommandContext>{
    outputJson,
    outputMarkdown,
    limit,
    offset
  }
}
