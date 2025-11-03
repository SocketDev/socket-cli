import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeReadFileSync, safeStatsSync } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { REDACTED } from '../../constants/cli.mts'
import ENV from '../../constants/env.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { tildify } from '../../utils/fs/home-path.mjs'
const logger = getDefaultLogger()

export async function outputCmdJson(cwd: string) {
  logger.info('Target cwd:', ENV.VITEST ? REDACTED : tildify(cwd))

  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  const tildeSockJsonPath = ENV.VITEST ? REDACTED : tildify(sockJsonPath)

  if (!existsSync(sockJsonPath)) {
    logger.fail(`Not found: ${tildeSockJsonPath}`)
    process.exitCode = 1
    return
  }

  if (!safeStatsSync(sockJsonPath)?.isFile()) {
    logger.fail(
      `This is not a regular file (maybe a directory?): ${tildeSockJsonPath}`,
    )
    process.exitCode = 1
    return
  }

  logger.success(`This is the contents of ${tildeSockJsonPath}:`)
  logger.error('')

  const data = safeReadFileSync(sockJsonPath)
  logger.log(data)
}
