import { promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'

import { readJson } from './fs.mts'
import { PackageURL } from './purl.mts'
import manifest from './registry-manifest.json' with { type: 'json' }
import { stripBom } from './strings.mts'

export type PackageJson = {
  name?: string | undefined
  version?: string | undefined
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  optionalDependencies?: Record<string, string> | undefined
  peerDependencies?: Record<string, string> | undefined
  workspaces?: unknown
  [key: string]: unknown
}

/** Structural surface consumed from @npmcli/package-json's editable instance. */
export type EditablePackageJson = {
  content: PackageJson
  update(data: Partial<PackageJson>): EditablePackageJson
  fromJSON(data: string | PackageJson): EditablePackageJson
  willSave(options?: { ignoreWhitespace?: boolean; sort?: boolean }): boolean
  save(options?: {
    ignoreWhitespace?: boolean
    sort?: boolean
  }): Promise<boolean>
  saveSync(options?: { ignoreWhitespace?: boolean; sort?: boolean }): boolean
}

export type ToEditablePackageJsonOptions = {
  path: string
}

type ReadOptions = {
  throws?: boolean | undefined
  editable?: boolean | undefined
}

function packageJsonPath(filepath: string): string {
  return filepath.endsWith('package.json')
    ? filepath
    : path.join(filepath, 'package.json')
}

export function readPackageJson(
  filepath: string,
  options: ReadOptions & { editable: true },
): Promise<EditablePackageJson | undefined>
export function readPackageJson(
  filepath: string,
  options?: ReadOptions & { editable?: false | undefined },
): Promise<PackageJson | null>
export async function readPackageJson(
  filepath: string,
  options?: ReadOptions,
): Promise<PackageJson | EditablePackageJson | null | undefined> {
  const filename = packageJsonPath(filepath)
  if (!options?.editable) {
    return (await readJson(
      filename,
      options?.throws === undefined ? undefined : { throws: options.throws },
    )) as PackageJson | null
  }
  let source: string
  try {
    source = await fs.readFile(filename, 'utf8')
  } catch (error) {
    if (options.throws !== false) {
      throw error
    }
    return undefined
  }
  let parsed: PackageJson
  try {
    parsed = JSON.parse(stripBom(source)) as PackageJson
  } catch (error) {
    if (options.throws !== false) {
      throw error
    }
    return undefined
  }
  return createEditablePackageJson(filename, parsed, source)
}

function createEditablePackageJson(
  filename: string,
  initial: PackageJson,
  source: string,
): EditablePackageJson {
  let content = { ...initial }
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  '
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const serialize = (sort?: boolean): string => {
    const next = sort
      ? Object.fromEntries(
          Object.entries(content).sort(([a], [b]) => a.localeCompare(b)),
        )
      : content
    return bom + `${JSON.stringify(next, null, indent)}\n`.replaceAll('\n', eol)
  }
  const willSave = (saveOptions?: {
    ignoreWhitespace?: boolean
    sort?: boolean
  }): boolean => {
    const text = serialize(saveOptions?.sort)
    return !(
      (saveOptions?.ignoreWhitespace && text.trim() === source.trim()) ||
      text === source
    )
  }
  const editable: EditablePackageJson = {
    get content() {
      return content
    },
    update(data) {
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) {
          delete content[key]
        } else {
          content[key] = value
        }
      }
      return editable
    },
    fromJSON(data) {
      content = {
        ...(typeof data === 'string'
          ? (JSON.parse(data) as PackageJson)
          : data),
      }
      return editable
    },
    willSave,
    async save(saveOptions) {
      if (!willSave(saveOptions)) {
        return false
      }
      const text = serialize(saveOptions?.sort)
      await fs.writeFile(filename, text)
      source = text
      content = JSON.parse(stripBom(text)) as PackageJson
      return true
    },
    saveSync(saveOptions) {
      if (!willSave(saveOptions)) {
        return false
      }
      const text = serialize(saveOptions?.sort)
      writeFileSync(filename, text)
      source = text
      content = JSON.parse(stripBom(text)) as PackageJson
      return true
    },
  }
  return editable
}

export async function toEditablePackageJson(
  content: PackageJson,
  options: ToEditablePackageJsonOptions,
): Promise<EditablePackageJson> {
  const filename = packageJsonPath(options.path)
  let source = ''
  try {
    source = await fs.readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  return createEditablePackageJson(filename, content, source)
}

export function resolvePackageName(
  purlObj: { name: string; namespace?: string | undefined },
  delimiter = '/',
): string {
  const { name, namespace } = purlObj
  return `${namespace ? `${namespace}${delimiter}` : ''}${name}`
}

export type RegistryManifestData = {
  name: string
  package: string
  version: string
  [key: string]: unknown
}
export type RegistryManifestEntry = readonly [
  purl: string,
  data: RegistryManifestData,
]

/**
 * Returns Socket registry metadata for an ecosystem or package name.
 *
 * Refresh the data by reviewing changes to the upstream manifest.
 */
export function getManifestData(
  ecosystem: string,
): readonly RegistryManifestEntry[] | undefined
export function getManifestData(
  ecosystem: string,
  sockRegPkgName: string,
): RegistryManifestData | undefined
export function getManifestData(): Record<
  string,
  readonly RegistryManifestEntry[]
>
export function getManifestData(
  ecosystem?: string,
  sockRegPkgName?: string,
):
  | Record<string, readonly RegistryManifestEntry[]>
  | readonly RegistryManifestEntry[]
  | RegistryManifestData
  | undefined {
  const entries = manifest as unknown as Record<
    string,
    readonly RegistryManifestEntry[]
  >
  if (ecosystem) {
    const ecosystemEntries = entries[ecosystem]
    return sockRegPkgName
      ? ecosystemEntries?.find(
          ([purl]) => PackageURL.fromString(purl).name === sockRegPkgName,
        )?.[1]
      : ecosystemEntries
  }
  return manifest as unknown as Record<string, readonly RegistryManifestEntry[]>
}
