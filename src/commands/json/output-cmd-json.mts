import { existsSync } from 'node:fs'
import path from 'node:path'

import constants, { REDACTED, SOCKET_JSON } from '../../constants.mts'
import { safeReadFileSync, safeStatsSync } from '../../utils/fs.mts'
import { logger } from '../../utils/logger.mts'
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
