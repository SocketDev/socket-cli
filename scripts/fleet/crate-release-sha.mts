#!/usr/bin/env node
/*
 * @file Print the Git commit Cargo recorded in a published crates.io archive.
 *
 *   Cargo writes `.cargo_vcs_info.json` into a packaged crate. Reading that
 *   file gives us the release's exact source commit even when a repository's
 *   local tags or version-bump commits no longer identify the published tree.
 *
 *   Usage:
 *     node scripts/fleet/crate-release-sha.mts <crate>
 *     node scripts/fleet/crate-release-sha.mts <crate> --version <x.y.z>
 *     node scripts/fleet/crate-release-sha.mts <crate> --json
 */

import { request } from 'node:https'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const CRATES_IO_ORIGIN = 'https://crates.io'
const MAX_REDIRECTS = 5
const TAR_BLOCK_SIZE = 512
const textDecoder = new TextDecoder()

export interface CargoVcsInfo {
  dirty?: boolean | undefined
  pathInVcs?: string | undefined
  sha: string
}

export interface CrateReleaseInfo extends CargoVcsInfo {
  crate: string
  version: string
}

interface CliOptions {
  crate: string
  json: boolean
  version?: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHeaderText(
  archive: Uint8Array,
  start: number,
  length: number,
): string {
  const field = archive.subarray(start, start + length)
  const end = field.indexOf(0)
  return textDecoder.decode(end === -1 ? field : field.subarray(0, end)).trim()
}

function readTarSize(archive: Uint8Array, headerOffset: number): number {
  const raw = readHeaderText(archive, headerOffset + 124, 12)
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`invalid tar size field ${JSON.stringify(raw)}`)
  }
  return Number.parseInt(raw, 8)
}

function parseCargoVcsInfo(source: Uint8Array): CargoVcsInfo {
  const value: unknown = JSON.parse(textDecoder.decode(source))
  if (!isRecord(value)) {
    throw new Error('the file has no `git` object')
  }
  const git = value['git']
  if (!isRecord(git)) {
    throw new Error('the file has no `git` object')
  }
  const sha = git['sha1']
  if (typeof sha !== 'string' || !/^[a-f\d]{40}$/i.test(sha)) {
    throw new Error('the file has no 40-character `git.sha1`')
  }
  const dirty = git['dirty']
  const pathInVcs = value['path_in_vcs']
  return {
    dirty: typeof dirty === 'boolean' ? dirty : undefined,
    pathInVcs: typeof pathInVcs === 'string' ? pathInVcs : undefined,
    sha: sha.toLowerCase(),
  }
}

export function cargoVcsInfoFromTar(archive: Uint8Array): CargoVcsInfo {
  for (let offset = 0; offset + TAR_BLOCK_SIZE <= archive.length;) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_SIZE)
    if (header.every(byte => byte === 0)) {
      break
    }

    const name = readHeaderText(archive, offset, 100)
    const prefix = readHeaderText(archive, offset + 345, 155)
    const fileName = prefix ? `${prefix}/${name}` : name
    const size = readTarSize(archive, offset)
    const dataStart = offset + TAR_BLOCK_SIZE
    const dataEnd = dataStart + size
    if (dataEnd > archive.length) {
      throw new Error(
        `tar entry ${JSON.stringify(fileName)} exceeds the archive`,
      )
    }
    if (
      fileName === '.cargo_vcs_info.json' ||
      fileName.endsWith('/.cargo_vcs_info.json')
    ) {
      return parseCargoVcsInfo(archive.subarray(dataStart, dataEnd))
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE
  }
  throw new Error('the archive has no `.cargo_vcs_info.json`')
}

export function newestPublishedVersion(metadata: unknown): string {
  if (!isRecord(metadata)) {
    throw new Error('the registry response has no `versions` array')
  }
  const versions = metadata['versions']
  if (!Array.isArray(versions)) {
    throw new Error('the registry response has no `versions` array')
  }
  let newest: { createdAt: number; version: string } | undefined
  for (const item of versions) {
    if (
      !isRecord(item) ||
      item['yanked'] === true ||
      typeof item['num'] !== 'string'
    ) {
      continue
    }
    const createdAt =
      typeof item['created_at'] === 'string'
        ? Date.parse(item['created_at'])
        : NaN
    if (!Number.isFinite(createdAt)) {
      continue
    }
    if (!newest || createdAt > newest.createdAt) {
      newest = { createdAt, version: item['num'] }
    }
  }
  if (!newest) {
    throw new Error('the registry response has no non-yanked release')
  }
  return newest.version
}

async function download(
  url: URL,
  accept: 'application/json' | 'application/octet-stream',
  redirectCount = 0,
): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          accept,
          'user-agent': 'socket-wheelhouse/crate-release-sha',
        },
      },
      response => {
        const status = response.statusCode ?? 0
        const location = response.headers.location
        if (status >= 300 && status < 400 && location) {
          response.resume()
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`too many redirects while fetching ${url.href}`))
            return
          }
          void download(new URL(location, url), accept, redirectCount + 1).then(
            resolve,
            reject,
          )
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          reject(new Error(`HTTP ${status} while fetching ${url.href}`))
          return
        }
        const chunks: Uint8Array[] = []
        response.on('data', (chunk: Uint8Array) => chunks.push(chunk))
        response.on('end', () => {
          const length = chunks.reduce(
            (total, chunk) => total + chunk.length,
            0,
          )
          const bytes = new Uint8Array(length)
          let offset = 0
          for (let i = 0, { length } = chunks; i < length; i += 1) {
            const chunk = chunks[i]!
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          resolve(bytes)
        })
        response.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function parseCli(args: string[]): CliOptions {
  let crate = ''
  let json = false
  let version: string | undefined
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (arg === '--json') {
      json = true
    } else if (arg === '--version') {
      version = args[i + 1]
      i += 1
      if (!version) {
        throw new Error('`--version` requires a value')
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${JSON.stringify(arg)}`)
    } else if (!crate) {
      crate = arg
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`)
    }
  }
  if (!crate) {
    throw new Error('no crate name was provided')
  }
  return { crate, json, version }
}

async function crateReleaseInfo(
  options: CliOptions,
): Promise<CrateReleaseInfo> {
  const opts = { __proto__: null, ...options } as CliOptions
  const name = encodeURIComponent(opts.crate)
  let version = opts.version
  if (!version) {
    const metadataBytes = await download(
      new URL(`/api/v1/crates/${name}`, CRATES_IO_ORIGIN),
      'application/json',
    )
    const metadata: unknown = JSON.parse(textDecoder.decode(metadataBytes))
    version = newestPublishedVersion(metadata)
  }
  const archive = await download(
    new URL(
      `/api/v1/crates/${name}/${encodeURIComponent(version)}/download`,
      CRATES_IO_ORIGIN,
    ),
    'application/octet-stream',
  )
  return {
    crate: opts.crate,
    version,
    ...cargoVcsInfoFromTar(gunzipSync(archive)),
  }
}

async function main(): Promise<void> {
  try {
    const options = parseCli(process.argv.slice(2))
    const info = await crateReleaseInfo(options)
    process.stdout.write(
      options.json
        ? `${JSON.stringify(info, undefined, 2)}\n`
        : `${info.sha}\n`,
    )
  } catch (error) {
    const detail = errorMessage(error)
    process.stderr.write(
      `crate-release-sha: could not resolve the published source commit.\n` +
        `  Where: crates.io metadata or the downloaded .crate archive.\n` +
        `  Saw: ${detail}. Wanted: a valid Cargo .cargo_vcs_info.json git SHA.\n` +
        `  Fix: check the crate name/version and network access, then retry.\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
