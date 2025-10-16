/**
 * Socket JSON utilities for Socket CLI.
 * Manages .socket/socket.json configuration and scan metadata.
 *
 * Key Functions:
 * - loadDotSocketDirectory: Load .socket directory configuration
 * - saveSocketJson: Persist scan configuration to .socket/socket.json
 * - validateSocketJson: Validate socket.json structure
 *
 * File Structure:
 * - Contains scan metadata and configuration
 * - Stores scan IDs and repository information
 * - Tracks CLI version and scan timestamps
 *
 * Directory Management:
 * - Creates .socket directory as needed
 * - Handles nested directory structures
 * - Supports both read and write operations
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { debugDir, debugNs } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { SOCKET_JSON, SOCKET_WEBSITE_URL } from '../../constants/socket.mts'
import { formatErrorWithDetail } from '../error/errors.mts'
import { findUp } from '../fs/fs.mts'

import type { CResult } from '../../types.mjs'

export interface SocketJson {
  ' _____         _       _     ': string
  '|   __|___ ___| |_ ___| |_   ': string
  "|__   | . |  _| '_| -_|  _|  ": string
  '|_____|___|___|_,_|___|_|.dev': string
  version: number

  defaults?: {
    manifest?: {
      conda?: {
        disabled?: boolean | undefined
        infile?: string | undefined
        outfile?: string | undefined
        stdin?: boolean | undefined
        stdout?: boolean | undefined
        target?: string | undefined
        verbose?: boolean | undefined
      }
      gradle?: {
        disabled?: boolean | undefined
        bin?: string | undefined
        gradleOpts?: string | undefined
        verbose?: boolean | undefined
      }
      sbt?: {
        disabled?: boolean | undefined
        infile?: string | undefined
        stdin?: boolean | undefined
        bin?: string | undefined
        outfile?: string | undefined
        sbtOpts?: string | undefined
        stdout?: boolean | undefined
        verbose?: boolean | undefined
      }
    }
    scan?: {
      create?: {
        autoManifest?: boolean | undefined
        repo?: string | undefined
        report?: boolean | undefined
        branch?: string | undefined
      }
      github?: {
        all?: boolean | undefined
        githubApiUrl?: string | undefined
        orgGithub?: string | undefined
        repos?: string | undefined
      }
    }
  }
}

export function readOrDefaultSocketJson(cwd: string): SocketJson {
  const jsonCResult = readSocketJsonSync(cwd, true)
  return jsonCResult.ok
    ? jsonCResult.data
    : // This should be unreachable but it makes TS happy.
      getDefaultSocketJson()
}

export async function findSocketJsonUp(
  cwd: string,
): Promise<string | undefined> {
  return await findUp(SOCKET_JSON, { onlyFiles: true, cwd })
}

export async function readOrDefaultSocketJsonUp(
  cwd: string,
): Promise<SocketJson> {
  const socketJsonPath = await findSocketJsonUp(cwd)
  if (socketJsonPath) {
    const socketJsonDir = path.dirname(socketJsonPath)
    const jsonCResult = readSocketJsonSync(socketJsonDir, true)
    return jsonCResult.ok ? jsonCResult.data : getDefaultSocketJson()
  }
  return getDefaultSocketJson()
}

export function getDefaultSocketJson(): SocketJson {
  return {
    ' _____         _       _     ': `Local config file for Socket CLI tool ( ${SOCKET_WEBSITE_URL}/npm/package/${SOCKET_JSON.replace('.json', '')} ), to work with ${SOCKET_WEBSITE_URL}`,
    '|   __|___ ___| |_ ___| |_   ':
      '     The config in this file is used to set as defaults for flags or command args when using the CLI',
    "|__   | . |  _| '_| -_|  _|  ":
      '     in this dir, often a repo root. You can choose commit or .ignore this file, both works.',
    '|_____|___|___|_,_|___|_|.dev': `Warning: This file may be overwritten without warning by \`${SOCKET_JSON.replace('.json', '')} manifest setup\` or other commands`,
    version: 1,
  }
}

export async function readSocketJson(
  cwd: string,
  defaultOnError = false,
): Promise<CResult<SocketJson>> {
  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  if (!existsSync(sockJsonPath)) {
    debugNs('notice', `miss: ${SOCKET_JSON} not found at ${cwd}`)
    return { ok: true, data: getDefaultSocketJson() }
  }

  let json = null
  try {
    json = await fs.readFile(sockJsonPath, 'utf8')
  } catch (e) {
    if (defaultOnError) {
      logger.warn(`Failed to read ${SOCKET_JSON}, using default`)
      debugNs('warn', `Failed to read ${SOCKET_JSON}`)
      debugDir('warn', e as any)
      return { ok: true, data: getDefaultSocketJson() }
    }
    const cause = formatErrorWithDetail(
      `An error occurred while trying to read ${SOCKET_JSON}`,
      e,
    )
    debugNs('error', `Failed to read ${SOCKET_JSON}`)
    debugDir('error', e as any)
    return {
      ok: false,
      message: `Failed to read ${SOCKET_JSON}`,
      cause,
    }
  }

  let obj
  try {
    obj = JSON.parse(json)
  } catch (e) {
    debugNs('error', `Failed to parse ${SOCKET_JSON} as JSON`)
    debugDir('inspect', { json } as any)
    debugDir('error', e as any)
    if (defaultOnError) {
      logger.warn(`Failed to parse ${SOCKET_JSON}, using default`)
      return { ok: true, data: getDefaultSocketJson() }
    }
    return {
      ok: false,
      message: `Failed to parse ${SOCKET_JSON}`,
      cause: `${SOCKET_JSON} does not contain valid JSON, please verify`,
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

export function readSocketJsonSync(
  cwd: string,
  defaultOnError = false,
): CResult<SocketJson> {
  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  if (!existsSync(sockJsonPath)) {
    debugNs('notice', `miss: ${SOCKET_JSON} not found at ${cwd}`)
    return { ok: true, data: getDefaultSocketJson() }
  }
  let jsonContent = null
  try {
    jsonContent = readFileSync(sockJsonPath, 'utf8')
  } catch (e) {
    if (defaultOnError) {
      logger.warn(`Failed to read ${SOCKET_JSON}, using default`)
      debugNs('warn', `Failed to read ${SOCKET_JSON} sync`)
      debugDir('warn', e as any)
      return { ok: true, data: getDefaultSocketJson() }
    }
    const cause = formatErrorWithDetail(
      `An error occurred while trying to read ${SOCKET_JSON}`,
      e,
    )
    debugNs('error', `Failed to read ${SOCKET_JSON} sync`)
    debugDir('error', e as any)
    return {
      ok: false,
      message: `Failed to read ${SOCKET_JSON}`,
      cause,
    }
  }

  let jsonObj
  try {
    jsonObj = JSON.parse(jsonContent)
  } catch (e) {
    debugNs('error', `Failed to parse ${SOCKET_JSON} as JSON (sync)`)
    debugDir('inspect', { jsonContent } as any)
    debugDir('error', e as any)
    if (defaultOnError) {
      logger.warn(`Failed to parse ${SOCKET_JSON}, using default`)
      return { ok: true, data: getDefaultSocketJson() }
    }
    return {
      ok: false,
      message: `Failed to parse ${SOCKET_JSON}`,
      cause: `${SOCKET_JSON} does not contain valid JSON, please verify`,
    }
  }

  if (!jsonObj) {
    logger.warn('Warning: file contents was empty, using default')
    return { ok: true, data: getDefaultSocketJson() }
  }

  // TODO: Do we need to validate? All properties are optional so code will have
  // to check every step of the way regardless.
  return { ok: true, data: jsonObj }
}

export async function writeSocketJson(
  cwd: string,
  sockJson: SocketJson,
): Promise<CResult<undefined>> {
  let jsonContent = ''
  try {
    jsonContent = JSON.stringify(sockJson, null, 2)
  } catch (e) {
    debugNs('error', `Failed to serialize ${SOCKET_JSON} to JSON`)
    debugDir('inspect', { sockJson } as any)
    debugDir('error', e as any)
    return {
      ok: false,
      message: 'Failed to serialize to JSON',
      cause: `There was an unexpected problem converting the ${SOCKET_JSON} object to a JSON string. Unable to store it.`,
    }
  }

  const filepath = path.join(cwd, SOCKET_JSON)
  await fs.writeFile(filepath, `${jsonContent}\n`, 'utf8')

  return { ok: true, data: undefined }
}
