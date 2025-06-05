import path from 'node:path'

import { handleCmdJson } from './handle-cmd-json.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

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

  await handleCmdJson(cwd)
}
