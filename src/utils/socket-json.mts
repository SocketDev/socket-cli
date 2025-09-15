import fs from 'node:fs'
import path from 'node:path'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { SOCKET_JSON, SOCKET_WEBSITE_URL } from '../constants.mts'

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

export function readSocketJsonSync(
  cwd: string,
  defaultOnError = false,
): CResult<SocketJson> {
  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  if (!existsSync(sockJsonPath)) {
    debugFn('notice', `miss: ${SOCKET_JSON} not found at ${cwd}`)
    return { ok: true, data: getDefaultSocketJson() }
  }
  let json = null
  try {
    json = fs.readFileSync(sockJsonPath, 'utf8')
  } catch (e) {
    if (defaultOnError) {
      logger.warn(`Failed to read ${SOCKET_JSON}, using default`)
      debugDir('inspect', { error: e })
      return { ok: true, data: getDefaultSocketJson() }
    }
    const msg = (e as Error)?.message
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: `Failed to read ${SOCKET_JSON}`,
      cause: `An error occurred while trying to read ${SOCKET_JSON}${msg ? `: ${msg}` : ''}`,
    }
  }

  let obj
  try {
    obj = JSON.parse(json)
  } catch (e) {
    debugFn('error', 'caught: JSON.parse error')
    debugDir('inspect', { error: e, json })
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

export async function writeSocketJson(
  cwd: string,
  sockJson: SocketJson,
): Promise<CResult<undefined>> {
  let json = ''
  try {
    json = JSON.stringify(sockJson, null, 2)
  } catch (e) {
    debugFn('error', 'caught: JSON.stringify error')
    debugDir('inspect', { error: e, sockJson })
    return {
      ok: false,
      message: 'Failed to serialize to JSON',
      cause: `There was an unexpected problem converting the ${SOCKET_JSON} object to a JSON string. Unable to store it.`,
    }
  }

  const filepath = path.join(cwd, SOCKET_JSON)
  await fs.writeFile(filepath, json + '\n', 'utf8')

  return { ok: true, data: undefined }
}
