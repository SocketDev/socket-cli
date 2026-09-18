import sea from 'node:sea'
import { fileURLToPath } from 'node:url'

import { getExecPath } from '@socketsecurity/lib-stable/constants/node'

import {
  buildSystemToolEnv,
  describeSystemToolFailure,
  findSystemTool,
} from './system-tool.mts'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'
import type { TrustedExecutable } from '../trusted-executable.mts'

export async function resolveNodeRuntime(
  options?: Pick<SpawnOptions, 'cwd' | 'env'> | undefined,
): Promise<TrustedExecutable> {
  const opts = { __proto__: null, ...options }
  const environment = opts.env ?? process.env
  if (!sea.isSea()) {
    return { executable: getExecPath(), environment: { ...environment } }
  }
  const cwd = opts.cwd instanceof URL ? fileURLToPath(opts.cwd) : opts.cwd
  const resolution = await findSystemTool('node', { cwd, env: environment })
  if (!resolution) {
    throw new Error(
      await describeSystemToolFailure('node', {
        cwd,
        installHint: 'Install Node.js to run JavaScript child tools.',
      }),
    )
  }
  return {
    executable: resolution.executable,
    environment: buildSystemToolEnv(environment, resolution.searchPath),
  }
}
