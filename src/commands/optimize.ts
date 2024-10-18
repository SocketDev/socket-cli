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
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  StringKeyValueObject
} from '../utils/package-manager-detector'

const distPath = __dirname

const OVERRIDES_FIELD_NAME = 'overrides'
const RESOLUTIONS_FIELD_NAME = 'resolutions'

const availableOverrides = getManifestData('npm')!.filter(({ 1: d }) =>
  d.engines?.node?.startsWith('>=18')
)

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides
type GetOverrides = (pkg: PackageJsonContent) => GetOverridesResult | undefined
type GetOverridesResult = { type: Agent; overrides: Overrides }

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
    const overrides = (pkgJson as any)?.pnpm?.overrides ?? undefined
    return overrides ? { type: 'pnpm', overrides } : undefined
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
      //   /name/version:
      //   'name': version
      //   name: version
      `(?<=^\\s*)(?:(['/])${escapedName}\\1|${escapedName}(?=:))`,
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
  pkgJsonPath: string
  pkgJsonStr: string
  pkgJson: PackageJsonContent
  overrides?: Overrides | undefined
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
  const overridesDataObjects = <GetOverridesResult[]>[
    getOverridesDataByAgent['npm'](editablePkgJson.content)
  ]
  const isApp = isPrivate || isWorkspace
  const overridesData =
    !isApp || agent !== 'npm'
      ? getOverridesDataByAgent[isApp ? agent : 'yarn'](editablePkgJson.content)
      : undefined
  if (overridesData) {
    overridesDataObjects.push(overridesData)
  }
  for (const { 1: data } of availableOverrides) {
    const { name: regPkgName, package: origPkgName, version } = data
    for (const { 1: depObj } of depEntries) {
      const pkgSpec = depObj[origPkgName]
      if (pkgSpec) {
        if (!pkgSpec.startsWith(`npm:${regPkgName}@`)) {
          packageNames.add(regPkgName)
          depObj[origPkgName] = `npm:${regPkgName}@^${version}`
        }
      }
    }
    for (const { overrides } of overridesDataObjects) {
      if (
        overrides &&
        !hasOwn(overrides, origPkgName) &&
        lockIncludes(lockSrc, origPkgName)
      ) {
        packageNames.add(regPkgName)
        overrides[origPkgName] = `npm:${regPkgName}@^${semver.major(version)}`
      }
    }
  }
  if (packageNames.size) {
    editablePkgJson.update(<PackageJsonContent>Object.fromEntries(depEntries))
    for (const { type, overrides } of overridesDataObjects) {
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
      const {
        agent,
        agentExecPath,
        isPrivate,
        isWorkspace,
        lockSrc,
        lockPath,
        pkgJsonPath,
        pkgJsonStr,
        pkgJson,
        supported
      } = await detect({
        cwd: process.cwd(),
        onUnknown(pkgManager: string | undefined) {
          console.log(
            `⚠️ Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}: Defaulting to npm`
          )
        }
      })
      if (!supported) {
        console.log('✘ The engines.node range is not supported.')
        return
      }
      if (pkgJson === undefined) {
        console.log('✘ No package.json found.')
        return
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
        await addOverrides(
          <AddOverridesConfig>{
            __proto__: null,
            agent: agent === 'bun' ? 'yarn' : agent,
            isPrivate,
            isWorkspace,
            lockIncludes,
            lockSrc,
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

      const lockName = lockPath ? path.basename(lockPath) : 'lock file'
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
              `💡 Re-run Socket Optimize whenever ${lockName} changes.\n  This can be skipped once npm ships https://github.com/npm/cli/pull/7025.`
            )
          }
        } catch {
          spinner.stop()
          console.log(`✘ socket ${agent} install: Failed to update ${lockName}`)
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
