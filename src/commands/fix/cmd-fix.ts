import meowOrDie from 'meow'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'
import { shadowNpmInstall } from '../../utils/npm'
import { getFlagListOutput } from '../../utils/output-formatting.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.ts'

const { SOCKET_CLI_IN_FIX_CMD, SOCKET_IPC_HANDSHAKE } = constants

const config: CliCommandConfig = {
  commandName: 'fix',
  description: 'Fix "fixable" Socket alerts',
  hidden: true,
  flags: {},
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Options
      ${getFlagListOutput(config.flags, 6)}
  `
}

export const cmdFix = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  meowOrDie(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags
  })

  // const prev = new Set(alerts.map(a => a.key))
  // let ret: SafeNode | undefined
  // /* eslint-disable no-await-in-loop */
  // while (alerts.length > 0) {
  //   await updateAdvisoryNodes(this, alerts)
  //   ret = await this[kRiskyReify](...args)
  //   await this.loadActual()
  //   await this.buildIdealTree()
  //   needInfoOn = getPackagesToQueryFromDiff(this.diff, {
  //     includeUnchanged: true
  //   })
  //   alerts = (
  //     await getPackagesAlerts(needInfoOn, {
  //       includeExisting: true,
  //       includeUnfixable: true
  //     })
  //   ).filter(({ key }) => {
  //     const unseen = !prev.has(key)
  //     if (unseen) {
  //       prev.add(key)
  //     }
  //     return unseen
  //   })
  // }
  // /* eslint-enable no-await-in-loop */
  // return ret!

  const spinner = new Spinner().start()
  try {
    await shadowNpmInstall({
      ipc: {
        [SOCKET_IPC_HANDSHAKE]: {
          [SOCKET_CLI_IN_FIX_CMD]: true
        }
      }
    })
  } catch (e: any) {
    console.error(e)
    spinner.error()
  } finally {
    spinner.stop()
  }
}
