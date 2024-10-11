// import chalk from 'chalk'
// import chalkTable from 'chalk-table'
import meow from 'meow'
import { getManifestData } from '@socketsecurity/registry'

//import ora from 'ora'
import { printFlagList } from '../utils/formatting'
import { writeFileUtf8 } from '../utils/fs'
import { indentedStringify, isParsableJSON } from '../utils/json'
import { hasOwn } from '../utils/objects'
import { detect } from '../utils/package-manager-detector'
import { escapeRegExp } from '../utils/regexps'
import { toSortedObject } from '../utils/sorts'
import { isBalanced } from '../utils/strings'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type {
  Agent,
  PackageJSONObject,
  StringKeyValueObject
} from '../utils/package-manager-detector'

const OVERRIDES_FIELD_NAME = 'overrides'

const RESOLUTIONS_FIELD_NAME = 'resolutions'

const SOCKET_REGISTRY_NAME = '@socketregistry'

const SOCKET_REGISTRY_MAJOR_VERSION = '^1'

const allPackages = getManifestData('npm')!.map(({ 1: d }) => d.package)

type Overrides = { [key: string]: string | StringKeyValueObject }

type OverridesFieldName = 'overrides' | 'resolutions'

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

type CreateManifest = (
  ref: PackageJSONObject,
  overrides: Overrides
) => PackageJSONObject

const createManifestByAgent: Record<Agent, CreateManifest> = {
  npm: (ref: PackageJSONObject, overrides: Overrides) =>
    <PackageJSONObject>{ ...ref, overrides },
  pnpm: (ref: PackageJSONObject, overrides: Overrides) =>
    <PackageJSONObject>{
      ...ref,
      pnpm: <PackageJSONObject>{
        ...(<StringKeyValueObject>(ref['pnpm'] ?? {})),
        overrides
      }
    },
  yarn: (ref: PackageJSONObject, overrides: Overrides) =>
    <PackageJSONObject>{ ...ref, resolutions: overrides }
} as const

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

type ModifyManifest = (content: string, overrides: Overrides) => ModifierState
type ModifierState = { output: string; modified?: boolean }

const modifyManifestByAgent: Record<Agent, ModifyManifest> = (() => {
  const makeAddOverridesFieldPattern = (fieldName: string) =>
    new RegExp(
      // Dependencies fields are objects of type: { [key: string]: string }
      // Overrides fields are objects of type: { [key: string]: string | ({ [key: string]: string }) }
      `(?<=\\n)(?<indent>\\s*)"${fieldName}":\\s*(?<block>\\{[\\s\\S]*?\\n\\1\\})(?<comma>,?)`
    )
  const dependenciesPattern = makeAddOverridesFieldPattern('dependencies')
  const devDependenciesPattern = makeAddOverridesFieldPattern('devDependencies')
  const optionalDependenciesPattern = makeAddOverridesFieldPattern(
    'optionalDependencies'
  )
  const peerDependenciesPattern =
    makeAddOverridesFieldPattern('peerDependencies')
  const afterOverridesPattern =
    makeAddOverridesFieldPattern(OVERRIDES_FIELD_NAME)

  const makeModifier = (fieldName: OverridesFieldName) => {
    const overridesFieldPattern = new RegExp(
      // Overrides fields are objects of type: { [key: string]: string | ({ [key: string]: string }) }
      `(?<=\\n)(?<before>(?<indent>\\s*)"${fieldName}":\\s*)(?<block>\\{[\\s\\S]*?\\n\\2\\})`
    )
    return (content: string, overrides: Overrides, modState: ModifierState) => {
      let modified = false
      const output = content.replace(
        overridesFieldPattern,
        (match: string, before: string, indent: string, block: string) => {
          modified = isBalanced('{', '}', block) && isParsableJSON(block)
          return modified
            ? `${before}${indentedStringify(overrides, indent)}`
            : match
        }
      )
      modState.modified = modified
      modState.output = modified ? output : content
      return modState
    }
  }

  const wrapModifier =
    ({
      modifier,
      fieldName
    }: {
      modifier: ReturnType<typeof makeModifier>
      fieldName: OverridesFieldName
    }) =>
    (content: string, overrides: Overrides) => {
      const modState: ModifierState = { output: content, modified: false }
      modifier(content, overrides, modState)
      if (modState.modified) {
        return modState
      }
      const addOverridesFieldReplacement = (
        match: string,
        indent: string,
        block: string,
        comma?: string
      ) => {
        modState.modified = isBalanced('{', '}', block) && isParsableJSON(block)
        return modState.modified
          ? `${match}${comma ? '' : ','}\n${indent}"${fieldName}": ${indentedStringify(overrides, indent)}${comma || ''}`
          : match
      }
      let output = modState.output

      if (fieldName !== OVERRIDES_FIELD_NAME) {
        output = modState.output.replace(
          afterOverridesPattern,
          addOverridesFieldReplacement
        )
      }
      if (!modState.modified) {
        output = modState.output.replace(
          peerDependenciesPattern,
          addOverridesFieldReplacement
        )
      }
      if (!modState.modified) {
        output = output.replace(
          optionalDependenciesPattern,
          addOverridesFieldReplacement
        )
      }
      if (!modState.modified) {
        output = output.replace(
          devDependenciesPattern,
          addOverridesFieldReplacement
        )
      }
      if (!modState.modified) {
        output = output.replace(
          dependenciesPattern,
          addOverridesFieldReplacement
        )
      }
      modState.output = output
      return modState
    }

  const overridesModifier = makeModifier(OVERRIDES_FIELD_NAME)
  const resolutionsModifier = makeModifier(RESOLUTIONS_FIELD_NAME)
  return {
    npm: wrapModifier({
      modifier: overridesModifier,
      fieldName: OVERRIDES_FIELD_NAME
    }),
    pnpm: wrapModifier({
      modifier: overridesModifier,
      fieldName: OVERRIDES_FIELD_NAME
    }),
    yarn: wrapModifier({
      modifier: resolutionsModifier,
      fieldName: RESOLUTIONS_FIELD_NAME
    })
  }
})()

type AddOverridesConfig = {
  agent: Agent
  lockSrc: string
  lockIncludes: LockIncludes
  pkgPath: string
  pkgJson: PackageJSONObject
  pkgJsonStr: string
  overrides?: Overrides | undefined
}

type AddOverridesState = {
  output: string
  packageNames: Set<string>
}

async function addOverrides(
  {
    agent,
    lockSrc,
    lockIncludes,
    pkgPath,
    pkgJson,
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
        clonedOverrides = { ...overrides }
      }
      addedCount += 1
      packageNames.add(name)
      clonedOverrides[name] =
        `npm:${SOCKET_REGISTRY_NAME}/${name}@${SOCKET_REGISTRY_MAJOR_VERSION}`
    }
  }
  if (addedCount) {
    const sortedOverrides = toSortedObject(clonedOverrides!)
    const modState = modifyManifestByAgent[agent](
      aoState.output,
      sortedOverrides
    )
    aoState.output = modState.modified
      ? modState.output
      : JSON.stringify(
          createManifestByAgent[agent](pkgJson, sortedOverrides),
          null,
          2
        )
    await writeFileUtf8(pkgPath, aoState.output)
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
      //const spinnerText = 'Searching dependencies...'
      //const spinner = ora(spinnerText).start()
      const { agent, lockSrc, pkgJson, pkgPath, pkgJsonStr, supported } =
        await detect({
          cwd: process.cwd(),
          onUnknown: (pkgManager: string | undefined) => {
            console.log(
              `Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}: Defaulting to npm`
            )
          }
        })
      if (!supported) {
        console.log('The engines.node range is not supported.')
        return
      }
      if (pkgJson === undefined) {
        console.log('No package.json found.')
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
              lockSrc,
              pkgPath,
              pkgJson,
              pkgJsonStr,
              ...config
            },
            aoState
          )
        }
      }
      const { size: count } = aoState.packageNames
      if (count) {
        console.log(`Added ${count} overrides!`)
      } else {
        console.log('Congratulations! No override optimizations needed 🚀')
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
