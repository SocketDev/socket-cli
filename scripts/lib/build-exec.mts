/**
 * @file Build execution utilities Centralized command execution for build
 *   script.
 */

import type { SpawnStdioResult } from '@socketsecurity/lib-stable/process/spawn/types'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { saveBuildLog } from './build-helpers.mts'

const logger = getDefaultLogger()

interface ExecOptions {
  buildDir?: string | undefined
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
}

/**
 * Execute a command and stream output.
 */
export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<SpawnStdioResult> {
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- helper accepts cwd; the process.cwd() default is for ad-hoc invocations, not a bypass of the anchor-on-script-location rule.
  const { buildDir, cwd = process.cwd(), env = process.env } = options

  const cmdStr = `$ ${command} ${args.join(' ')}`
  logger.log(cmdStr)

  if (buildDir) {
    await saveBuildLog(buildDir, cmdStr)
  }

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}: ${command} ${args.join(' ')}`,
    )
  }

  return result
}
