import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  safeReadFileSync,
  safeStatsSync,
} from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { REDACTED, SOCKET_JSON } from '../../constants.mts'
import { tildify } from '../../utils/tildify.mts'

export async function outputCmdJson(cwd: string) {
  logger.info('Target cwd:', constants.ENV.VITEST ? REDACTED : tildify(cwd))

  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  const tildeSockJsonPath = constants.ENV.VITEST
    ? REDACTED
    : tildify(sockJsonPath)

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
