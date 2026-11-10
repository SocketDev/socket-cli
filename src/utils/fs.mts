/**
 * File system utilities for Socket CLI.
 * Provides file and directory search functionality.
 *
 * Key Functions:
 * - findUp: Search for files/directories up the directory tree
 *
 * Features:
 * - Upward directory traversal
 * - Supports file and directory searching
 * - Abort signal support for cancellation
 * - Multiple name search support
 *
 * Usage:
 * - Finding configuration files (package.json, lockfiles)
 * - Locating project root directories
 * - Searching for specific files in parent directories
 */

import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import constants from '../constants.mts'
import { stripBom } from './strings.mts'

// Adapted from @socketsecurity/registry/lib/fs, MIT License.
// Copyright (c) 2024 Socket Inc
export type JsonContent = Record<string, unknown>

type ReadFileOptions = {
  encoding?: BufferEncoding | null | undefined
  flag?: string | undefined
  signal?: AbortSignal | undefined
}

type ReadJsonOptions = {
  encoding?: BufferEncoding
  flag?: string
  signal?: AbortSignal
  throws?: boolean
  reviver?: Parameters<typeof JSON.parse>[1]
}

type WriteJsonOptions = {
  EOL?: string
  finalEOL?: boolean
  replacer?: Parameters<typeof JSON.stringify>[1]
  spaces?: Parameters<typeof JSON.stringify>[2]
  encoding?: BufferEncoding
  flag?: string
  mode?: number | string
  signal?: AbortSignal
}

function parseJson(
  content: string | Buffer,
  filepath: string,
  reviver: ReadJsonOptions['reviver'],
  throws: boolean,
): JsonContent | null {
  try {
    const jsonText = Buffer.isBuffer(content)
      ? content.toString('utf8')
      : content
    return JSON.parse(stripBom(jsonText), reviver) as JsonContent
  } catch (error) {
    if (throws) {
      if (error && typeof filepath === 'string') {
        const parseError = error as Error
        parseError.message = `${filepath}: ${parseError.message}`
      }
      throw error
    }
    return null
  }
}

export async function readJson(
  filepath: string,
  options?: ReadJsonOptions | BufferEncoding,
): Promise<JsonContent | null> {
  if (typeof options === 'string') {
    options = { encoding: options }
  }
  const { reviver, throws, ...fsOptions } = { __proto__: null, ...options }
  const shouldThrow = throws === undefined || !!throws
  let content: string | Buffer
  try {
    content = await fs.readFile(filepath, { encoding: 'utf8', ...fsOptions })
  } catch (error) {
    if (shouldThrow) {
      throw error
    }
    return null
  }
  return parseJson(content, filepath, reviver, shouldThrow)
}

export function readJsonSync(
  filepath: string,
  options?: ReadJsonOptions | BufferEncoding,
): JsonContent | null {
  if (typeof options === 'string') {
    options = { encoding: options }
  }
  const { reviver, throws, ...fsOptions } = { __proto__: null, ...options }
  const shouldThrow = throws === undefined || !!throws
  let content: string | Buffer
  try {
    content = readFileSync(filepath, { encoding: 'utf8', ...fsOptions })
  } catch (error) {
    if (shouldThrow) {
      throw error
    }
    return null
  }
  return parseJson(content, filepath, reviver, shouldThrow)
}

export function safeStatsSync(
  filepath: import('node:fs').PathLike,
  options?: import('node:fs').StatSyncOptions,
): import('node:fs').Stats | import('node:fs').BigIntStats | undefined {
  try {
    return statSync(filepath, { throwIfNoEntry: false, ...options })
  } catch {}
  return undefined
}

export async function writeJson(
  filepath: string,
  jsonContent: JsonContent,
  options?: WriteJsonOptions | BufferEncoding,
): Promise<void> {
  if (typeof options === 'string') {
    options = { encoding: options }
  }
  const { EOL, finalEOL, replacer, spaces, ...fsOptions } = {
    __proto__: null,
    ...options,
  }
  const eol = EOL ?? '\n'
  const jsonString = `${JSON.stringify(jsonContent, replacer, spaces).replace(/\n/g, eol)}${finalEOL === false ? '' : eol}`
  await fs.writeFile(filepath, jsonString, { encoding: 'utf8', ...fsOptions })
}

export async function readFileBinary(
  filepath: string,
  options?: ReadFileOptions,
): Promise<Buffer> {
  return (await fs.readFile(filepath, {
    signal: constants.abortSignal,
    ...options,
    // `encoding: 'binary'` returns a latin1 string in Node, despite the
    // registry helper's Buffer declaration. Preserve the declared binary
    // contract and let Node return the bytes as a Buffer.
    encoding: null,
  })) as Buffer
}

export async function readFileUtf8(
  filepath: string,
  options?: ReadFileOptions,
): Promise<string> {
  return await fs.readFile(filepath, {
    signal: constants.abortSignal,
    ...options,
    encoding: 'utf8',
  })
}

export async function safeReadFile(
  filepath: string,
  options?: ReadFileOptions | string,
): Promise<string | Buffer | undefined> {
  try {
    const readOptions = typeof options === 'string' ? {} : options
    const encoding: BufferEncoding | null =
      (typeof options === 'string'
        ? (options as BufferEncoding)
        : options?.encoding) ?? 'utf8'
    return await fs.readFile(filepath, {
      ...readOptions,
      signal: constants.abortSignal,
      encoding,
    })
  } catch {}
  return undefined
}

export function safeReadFileSync(
  filepath: import('node:fs').PathOrFileDescriptor,
  options?: ReadFileOptions | string,
): string | Buffer | undefined {
  try {
    const readOptions = typeof options === 'string' ? {} : options
    const encoding: BufferEncoding | null =
      (typeof options === 'string'
        ? (options as BufferEncoding)
        : options?.encoding) ?? 'utf8'
    return readFileSync(filepath, {
      ...readOptions,
      encoding,
    })
  } catch {}
  return undefined
}

export function isDirSync(filepath: import('node:fs').PathLike): boolean {
  try {
    return existsSync(filepath) && statSync(filepath).isDirectory()
  } catch {
    return false
  }
}

export type FindUpOptions = {
  cwd?: string | undefined
  onlyDirectories?: boolean | undefined
  onlyFiles?: boolean | undefined
  signal?: AbortSignal | undefined
}

export async function findUp(
  name: string | string[],
  options?: FindUpOptions | undefined,
): Promise<string | undefined> {
  const opts = { __proto__: null, ...options }
  const { cwd = process.cwd(), signal = constants.abortSignal } = opts
  let { onlyDirectories = false, onlyFiles = true } = opts
  if (onlyDirectories) {
    onlyFiles = false
  }
  if (onlyFiles) {
    onlyDirectories = false
  }
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
      if (signal?.aborted) {
        return undefined
      }
      const thePath = path.join(dir, name)
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.stat(thePath)
        if (!onlyDirectories && stats.isFile()) {
          return thePath
        }
        if (!onlyFiles && stats.isDirectory()) {
          return thePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

export async function withTmpDir<T>(
  prefix: string,
  fn: (tmpDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), prefix))
  try {
    return await fn(tmpDir)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Symlink-resolved absolute path when the target exists (e.g. macOS symlinks
// /tmp -> /private/tmp); falls back to a plain resolve so a not-yet-existing
// path still gets a usable absolute value instead of throwing.
export async function realpathOrResolved(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch {
    return path.resolve(target)
  }
}
