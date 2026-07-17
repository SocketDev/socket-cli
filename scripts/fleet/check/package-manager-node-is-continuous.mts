#!/usr/bin/env node
// Fleet check — package-manager-node-is-continuous.
//
// A package-manager shim is often `#!/usr/bin/env node`. If its child `node`
// resolves differently from the fleet entrypoint, the same check/test run can
// execute under two runtimes. Compare the Node recorded by the active package-
// manager lifecycle, then probe the child `node` inherited from PATH. Do not
// recursively launch pnpm from inside its own lifecycle: hardened CI runners
// may intentionally prevent that even when Node continuity is correct.

import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- a one-shot check probe; no output needs streaming.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { envWithExecutableFirst } from '../lib/ensure-node.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export function sameExecutable(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right)
  } catch {
    return path.resolve(left) === path.resolve(right)
  }
}

export interface PackageManagerNodeOptions {
  executablePath: string
  npmNodeExecPath: string | undefined
}

export function isNodeExecutablePath(executablePath: string): boolean {
  const basename = path.win32.basename(executablePath).toLowerCase()
  return basename === 'node' || basename === 'node.exe'
}

export function packageManagerNodeExecutables(
  options: PackageManagerNodeOptions,
): readonly string[] {
  const opts = { __proto__: null, ...options } as PackageManagerNodeOptions
  // npm_node_execpath is historically a Node executable, but standalone pnpm
  // sets it to its own launcher in some CI environments. A package-manager
  // launcher is not evidence of a second Node runtime, so only compare the
  // lifecycle value when it actually names a Node executable.
  return opts.npmNodeExecPath && isNodeExecutablePath(opts.npmNodeExecPath)
    ? [opts.npmNodeExecPath, opts.executablePath]
    : [opts.executablePath]
}

export function main(): void {
  const result = spawnSync('node', ['-p', 'process.execPath'], {
    encoding: 'utf8',
    env: envWithExecutableFirst({
      env: process.env,
      executablePath: process.execPath,
    }),
  })
  const childNode = String(result.stdout ?? '').trim()
  const candidates = packageManagerNodeExecutables({
    executablePath: childNode,
    npmNodeExecPath: process.env['npm_node_execpath'],
  })
  if (
    result.status === 0 &&
    childNode &&
    candidates.every(candidate => sameExecutable(process.execPath, candidate))
  ) {
    logger.success('package-manager node matches the fleet runtime.')
    return
  }
  logger.error(
    '[package-manager-node-is-continuous] package-manager children use a different Node runtime.\n' +
      `  Fleet Node: ${process.execPath}\n` +
      `  Lifecycle Node: ${process.env['npm_node_execpath'] || '(not provided)'}\n` +
      `  Child Node: ${childNode || '(probe failed)'}\n` +
      '  Fix: run fleet commands through the pinned Node; package-manager children must inherit that Node directory first on PATH.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
