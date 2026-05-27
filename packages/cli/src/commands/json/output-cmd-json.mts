import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeStatSync } from '@socketsecurity/lib-stable/fs/inspect'
import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REDACTED } from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { tildify } from '../../util/fs/home-path.mjs'
const logger = getDefaultLogger()

export async function outputCmdJson(cwd: string) {
  logger.info('Target cwd:', VITEST ? REDACTED : tildify(cwd))

  const sockJsonPath = path.join(cwd, SOCKET_JSON)
  const tildeSockJsonPath = VITEST ? REDACTED : tildify(sockJsonPath)

  if (!existsSync(sockJsonPath)) {
    logger.fail(`Not found: ${tildeSockJsonPath}`)
    process.exitCode = 1
    return
  }

  if (!safeStatSync(sockJsonPath)?.isFile()) {
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
