import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import EditablePackageJson from '@npmcli/package-json'
import { getManifestData } from '@socketsecurity/registry'
import meow from 'meow'
import ora from 'ora'

import { printFlagList } from '../utils/formatting'
import { hasOwn, isObjectObject } from '../utils/objects'
import { detect } from '../utils/package-manager-detector'
import { escapeRegExp } from '../utils/regexps'
import { toSortedObject } from '../utils/sorts'

import type { Content as PackageJsonContentType } from '@npmcli/package-json'
import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  PackageJSONObject,
  StringKeyValueObject
} from '../utils/package-manager-detector'

const distPath = __dirname

const OVERRIDES_FIELD_NAME = 'overrides'

const RESOLUTIONS_FIELD_NAME = 'resolutions'

const SOCKET_REGISTRY_NAME = '@socketregistry'

const SOCKET_REGISTRY_MAJOR_VERSION = '^1'

const allPackages = getManifestData('npm')!
  .filter(({ 1: d }) => d.engines?.node?.startsWith('>=18'))
  .map(({ 1: d }) => d.package)

type NpmOverrides = { [key: string]: string | StringKeyValueObject }
type PnpmOrYarnOverrides = { [key: string]: string }
type Overrides = NpmOverrides | PnpmOrYarnOverrides

type GetManifestOverrides = (pkg: PackageJSONObject) => Overrides | undefined

const getManifestOverridesByAgent: Record<Agent, GetManifestOverrides> = {
  // npm overrides documentation:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
  npm: (pkgJson: PackageJSONObject) => (pkgJson as any)?.overrides ?? undefined,
  // pnpm overrides documentation:
  // https://pnpm.io/package_json#pnpmoverrides
  pnpm: (pkgJson: PackageJSONObject) =>
    (pkgJson as any)?.pnpm?.overrides ?? undefined,
  // Yarn resolutions documentation:
  // https://yarnpkg.com/configuration/manifest#resolutions
  yarn: (pkgJson: PackageJSONObject) =>
    (pkgJson as any)?.resolutions ?? undefined
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
      [OVERRIDES_FIELD_NAME]: overrides
    })
  },
  pnpm(editablePkgJson: EditablePackageJson, overrides: Overrides) {
    editablePkgJson.update({
      [OVERRIDES_FIELD_NAME]: overrides
    })
  },
  yarn(editablePkgJson: EditablePackageJson, overrides: PnpmOrYarnOverrides) {
    editablePkgJson.update({
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
  pkgJson: PackageJSONObject
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
    pkgJsonPath,
    overrides
  }: AddOverridesConfig,
  aoState: AddOverridesState
): Promise<AddOverridesState> {
  const { packageNames } = aoState
  let addedCount = 0
  let clonedOverrides: Overrides | undefined
  for (const name of allPackages) {
    if (!hasOwn(overrides, name) && lockIncludes(lockSrc, name)) {
      if (clonedOverrides === undefined) {
        clonedOverrides = (<unknown>{
          __proto__: null,
          ...overrides
        }) as Overrides
      }
      addedCount += 1
      packageNames.add(name)
      clonedOverrides[name] =
        `npm:${SOCKET_REGISTRY_NAME}/${name}@${SOCKET_REGISTRY_MAJOR_VERSION}`
    }
  }
  if (addedCount) {
    const editablePkgJson = await EditablePackageJson.load(
      path.dirname(pkgJsonPath)
    )
    const sortedOverrides = toSortedObject(clonedOverrides!)
    updateManifestByAgent[agent](editablePkgJson, sortedOverrides)
    if (!isPrivate && !isWorkspace) {
      if (
        hasOwn(editablePkgJson.content, 'pnpm') &&
        isObjectObject(editablePkgJson.content['pnpm'])
      ) {
        const pnpmKeys = Object.keys(editablePkgJson.content['pnpm'])
        editablePkgJson.update(
          (<unknown>(pnpmKeys.length === 1 && pnpmKeys[0] === 'overrides'
            ? // Properties with undefined values are omitted when saved as JSON.
              { pnpm: undefined }
            : {
                pnpm: {
                  __proto__: null,
                  ...(<object>editablePkgJson.content['pnpm']),
                  overrides: undefined
                }
              })) as PackageJsonContentType
        )
      }
      updateManifestByAgent.npm(editablePkgJson, sortedOverrides)
      updateManifestByAgent.yarn(editablePkgJson, sortedOverrides)
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
        const configs: {
          agent: Agent
          lockIncludes: LockIncludes
          overrides: Overrides | undefined
        }[] =
          agent === 'bun'
            ? [
                {
                  agent: 'npm',
                  lockIncludes: lockIncludesByAgent.yarn,
                  overrides: getManifestOverridesByAgent.npm(pkgJson)
                },
                {
                  agent: 'yarn',
                  lockIncludes: lockIncludesByAgent.yarn,
                  overrides: getManifestOverridesByAgent.yarn(pkgJson)
                }
              ]
            : [
                {
                  agent,
                  lockIncludes: lockIncludesByAgent[agent],
                  overrides: getManifestOverridesByAgent[agent](pkgJson)
                }
              ]

        for (const config of configs) {
          await addOverrides(
            <AddOverridesConfig>{
              __proto__: null,
              isPrivate,
              isWorkspace,
              lockSrc,
              pkgJsonPath,
              pkgJsonStr,
              pkgJson,
              ...config
            },
            aoState
          )
        }
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
