import fs from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { tildify } from '../../utils/tildify.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'json',
  description:
    'Display the `socket.json` that would be applied for target folder',
  hidden: true, // This is a power tool. No need to clutter the toplevel.
  flags: {
    ...commonFlags,
  },
  help: parentName => `
    Usage
      $ ${parentName} [CWD=.]

    Display the \`socket.json\` file that would apply when running relevant commands
    in the target directory.
  `,
}

export const cmdJson = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

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
