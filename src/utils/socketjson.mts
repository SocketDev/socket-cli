import fs from 'node:fs'
import path from 'node:path'

import { debugFn, debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import type { CResult } from '../types.mts'

export interface SocketJson {
  ' _____         _       _     ': string
  '|   __|___ ___| |_ ___| |_   ': string
  "|__   | . |  _| '_| -_|  _|  ": string
  '|_____|___|___|_,_|___|_|.dev': string
  version: number

  defaults?: {
    manifest?: {
      conda?: {
        disabled?: boolean
        infile?: string
        outfile?: string
        stdin?: boolean
        stdout?: boolean
        target?: string
        verbose?: boolean
      }
      gradle?: {
        disabled?: boolean
        bin?: string
        gradleOpts?: string
        verbose?: boolean
      }
      sbt?: {
        disabled?: boolean
        infile?: string
        stdin?: boolean
        bin?: string
        outfile?: string
        sbtOpts?: string
        stdout?: boolean
        verbose?: boolean
      }
    }
    scan?: {
      create?: {
        autoManifest?: boolean
        repo?: string
        report?: boolean
        branch?: string
      }
      github?: {
        all?: boolean
        githubApiUrl?: string
        orgGithub?: string
        repos?: string
      }
    }
  }
}

export async function readOrDefaultSocketJson(cwd: string) {
  const result = await readSocketJson(cwd, true)
  if (result.ok) {
    return result.data
  }
  // This should be unreachable but it makes TS happy
  return getDefaultSocketJson()
}

export function getDefaultSocketJson(): SocketJson {
  return {
    ' _____         _       _     ':
      'Local config file for Socket CLI tool ( https://npmjs.org/socket ), to work with https://socket.dev',
    '|   __|___ ___| |_ ___| |_   ':
      '     The config in this file is used to set as defaults for flags or command args when using the CLI',
    "|__   | . |  _| '_| -_|  _|  ":
      '     in this dir, often a repo root. You can choose commit or .ignore this file, both works.',
    '|_____|___|___|_,_|___|_|.dev':
      'Warning: This file may be overwritten without warning by `socket manifest setup` or other commands',
    version: 1,
  }
}

export async function readSocketJson(
  cwd: string,
  defaultOnError = false,
): Promise<CResult<SocketJson>> {
  const sockJsonPath = path.join(cwd, 'socket.json')
  if (!fs.existsSync(sockJsonPath)) {
    debugFn(`miss: file not found ${sockJsonPath}`)
    return { ok: true, data: getDefaultSocketJson() }
  }

  let json = null
  try {
    json = await fs.promises.readFile(sockJsonPath, 'utf8')
  } catch (e) {
    debugLog('[DEBUG] Raw error:')
    debugLog(e)

    if (defaultOnError) {
      logger.warn('Warning: failed to read file, using default')
      return { ok: true, data: getDefaultSocketJson() }
    }
    const msg = (e as { message: string })?.message || '(none)'
    return {
      ok: false,
      message: 'Failed to read file',
      cause: `An error was thrown while trying to read your socket.json: ${msg}`,
    }
  }

  let obj
  try {
    obj = JSON.parse(json)
  } catch {
    debugLog('[DEBUG] Failed to parse content as JSON')
    debugLog(`[DEBUG] File contents ${json?.length ?? 0}:`)
    debugLog(json)

    if (defaultOnError) {
      logger.warn('Warning: failed to parse file, using default')
      return { ok: true, data: getDefaultSocketJson() }
    }

    return {
      ok: false,
      message: 'Failed to parse socket.json',
      cause:
        'It seems your socket.json did not contain valid JSON, please verify',
    }
  }

  if (!obj) {
    logger.warn('Warning: file contents was empty, using default')
    return { ok: true, data: getDefaultSocketJson() }
  }

  // Do we really care to validate? All properties are optional so code will have
  // to check every step of the way regardless. Who cares about validation here...?

  return { ok: true, data: obj }
}

export async function writeSocketJson(
  cwd: string,
  sockJson: SocketJson,
): Promise<CResult<undefined>> {
  let json = ''
  try {
    json = JSON.stringify(sockJson, null, 2)
  } catch (e) {
    debugFn('fail: JSON.stringify\n', e)
    debugLog('[DEBUG] Object:')
    debugLog(sockJson)

    return {
      ok: false,
      message: 'Failed to serialize to JSON',
      cause:
        'There was an unexpected problem converting the socket json object to a JSON string. Unable to store it.',
    }
  }

  const filepath = path.join(cwd, 'socket.json')
  await fs.promises.writeFile(filepath, json + '\n', 'utf8')

  return { ok: true, data: undefined }
}
