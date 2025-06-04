import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { tildify } from '../../utils/tildify.mts'

export async function outputCmdJson(cwd: string) {
  logger.info('Target cwd:', constants.ENV.VITEST ? '<redacted>' : tildify(cwd))

  const sjpath = path.join(cwd, 'socket.json')
  const tildeSjpath = constants.ENV.VITEST ? '<redacted>' : tildify(sjpath)

  if (!fs.existsSync(sjpath)) {
    logger.fail(`Not found: ${tildeSjpath}`)
    process.exitCode = 1
    return
  }

  if (!fs.lstatSync(sjpath).isFile()) {
    logger.fail(
      `This is not a regular file (maybe a directory?): ${tildeSjpath}`,
    )
    process.exitCode = 1
    return
  }

  const data = fs.readFileSync(sjpath, 'utf8')

  logger.success(`This is the contents of ${tildeSjpath}:`)
  logger.error('')
  logger.log(data)
}
