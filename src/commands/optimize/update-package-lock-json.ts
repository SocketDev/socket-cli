import spawn from '@npmcli/promise-spawn'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'
import { safeNpmInstall } from '../../utils/npm'

import type { Agent } from '../../utils/package-manager-detector'

const { NPM, SOCKET_CLI_SAFE_WRAPPER, abortSignal } = constants

const COMMAND_TITLE = 'Socket Optimize'
const NPM_OVERRIDE_PR_URL = 'https://github.com/npm/cli/pull/8089'

export async function updatePackageLockJson(
  lockName: string,
  agentExecPath: string,
  agent: Agent,
  spinner: Spinner
) {
  spinner.start(`Updating ${lockName}...`)
  try {
    if (agent === NPM) {
      const ipc = {
        [SOCKET_CLI_SAFE_WRAPPER]: true
      }
      await safeNpmInstall({ ipc })
      // TODO: This is a temporary workaround for a `npm ci` bug where it
      //       will error out after Socket Optimize generates a lock file.
      //       More investigation is needed.
      await safeNpmInstall({
        args: ['--ignore-scripts', '--package-lock-only'],
        ipc
      })
    } else {
      // All package managers support the "install" command.
      await spawn(agentExecPath, ['install'], {
        signal: abortSignal,
        stdio: 'ignore'
      })
    }
    spinner.stop()
    if (agent === NPM) {
      console.log(
        `💡 Re-run ${COMMAND_TITLE} whenever ${lockName} changes.\n   This can be skipped once npm ships ${NPM_OVERRIDE_PR_URL}.`
      )
    }
  } catch (e: any) {
    spinner.error(
      `${COMMAND_TITLE}: ${agent} install failed to update ${lockName}`
    )
    console.error(e)
  }
}
