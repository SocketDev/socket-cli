/**
 * Cache-key derivation and manifest-loading helpers for the build-pipeline
 * orchestrator. Split out of build-pipeline.mts to keep each module under
 * the fleet file-size cap.
 *
 * @module build-infra/lib/pipeline-cache
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors'

import { validateExternalTools } from './external-tools-schema.mts'
import type {
  PackageJsonLike,
  ParsedFlags,
  SourceMap,
  ToolVersions,
} from './pipeline-types.mts'

export interface BuildCacheKeyOptions {
  buildMode: string
  extraHash?: string | undefined
  nodeVersion: string
  packageVersion: string
  platformArch: string
  sources: SourceMap
  toolsHash: string
  toolVersions: ToolVersions
}

export function buildCacheKey({
  buildMode,
  extraHash,
  nodeVersion,
  packageVersion,
  platformArch,
  sources,
  toolsHash,
  toolVersions,
}: BuildCacheKeyOptions): string {
  const hash = crypto.createHash('sha256')
  hash.update(`node=${nodeVersion}`)
  hash.update(`platformArch=${platformArch}`)
  hash.update(`mode=${buildMode}`)
  hash.update(`tools=${toolsHash}`)
  for (const tool of Object.keys(toolVersions).toSorted()) {
    hash.update(`${tool}@${toolVersions[tool]}`)
  }
  for (const key of Object.keys(sources).toSorted()) {
    const src = sources[key] ?? {}
    hash.update(
      `src:${key}=${src.version ?? ''}:${src.ref ?? ''}:${src.url ?? ''}`,
    )
  }
  if (extraHash) {
    hash.update(`extra=${extraHash}`)
  }
  const digest = hash.digest('hex').slice(0, 12)
  return `v${nodeVersion}-${platformArch}-${buildMode}-${digest}-${packageVersion}`
}

export function hashFileContents(files: string[]): string {
  const hash = crypto.createHash('sha256')
  for (const file of files.toSorted()) {
    let content = Buffer.alloc(0)
    if (existsSync(file)) {
      try {
        content = readFileSync(file)
      } catch {}
    }
    hash.update(`${file}:`)
    hash.update(content)
  }
  return hash.digest('hex').slice(0, 16)
}

export interface LoadedExternalTools {
  rawHash: string
  versions: ToolVersions
}

export async function loadExternalTools(
  packageRoot: string,
): Promise<LoadedExternalTools> {
  const filePath = path.join(packageRoot, 'external-tools.json')
  const data = await readJson(filePath)
  if (!data) {
    return { versions: {}, rawHash: '' }
  }
  const validated = validateExternalTools(data)
  if (!validated.ok) {
    const details = validated.errors
      .map(e => `  ${e.path}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid external-tools.json at ${filePath}:\n${details}`)
  }
  const versions: ToolVersions = {}
  for (const [tool, meta] of Object.entries(validated.value.tools ?? {})) {
    versions[tool] = meta?.version ?? ''
  }
  const rawHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16)
  return { versions, rawHash }
}

export async function loadPackageJson(
  packageRoot: string,
): Promise<PackageJsonLike> {
  const pkg = await readJson(path.join(packageRoot, 'package.json'))
  if (!pkg) {
    throw new Error(`Missing package.json in ${packageRoot}`)
  }
  return pkg as PackageJsonLike
}

export function parseFlags(argv: string[]): ParsedFlags {
  const args = new Set(argv)
  const getValue = (flag: string): string | undefined => {
    const prefix = `${flag}=`
    for (const arg of argv) {
      if (arg.startsWith(prefix)) {
        return arg.slice(prefix.length)
      }
    }
    return undefined
  }
  return {
    force: args.has('--force'),
    clean: args.has('--clean'),
    printCacheKey: args.has('--cache-key'),
    cleanStage: getValue('--clean-stage'),
    fromStage: getValue('--from-stage'),
    raw: args,
  }
}

export async function readJson(filePath: string): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw new Error(`Failed to read ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
}
