/**
 * Factory for "tool spawner" functions in the dlx/spawn-* family.
 *
 * Every per-tool wrapper exposes the same triple:
 *
 * - Spawn{Tool}Dlx — npm-CLI mode (download / local override / GitHub release)
 * - Spawn{Tool}Vfs — SEA mode (extract from VFS bundle)
 * - Spawn{Tool} — auto-dispatch between the two based on isSeaBinary()
 *
 * The auto-dispatch and the GitHub-release flow are identical across the
 * pure-binary tools (trufflehog, trivy, opengrep). This factory encapsulates
 * both so per-tool files can declare just `name + resolver` and get the rest.
 *
 * Hybrid tools that need local-path overrides or extra wiring (cdxgen, sfw,
 * socket-patch) keep their bespoke Dlx implementations and only call
 * `defineAutoDispatch` for the auto-dispatcher.
 */

import { spawn } from '@socketsecurity/lib-stable/spawn'

import { downloadGitHubReleaseBinary, spawnToolVfs } from './spawn.mts'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { isSeaBinary } from '../sea/detect.mts'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { BinaryResolution } from './resolve-binary.mts'
import type { ExternalTool } from './vfs-extract.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/spawn'

/**
 * Argument shape for every spawn function the factory emits.
 */
export type ToolSpawnFn = (
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
) => Promise<DlxSpawnResult>

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s
}

/**
 * Build the standard auto-dispatcher: in SEA mode use VFS, otherwise use Dlx.
 *
 * Used by every tool wrapper in the dlx/spawn-* family.
 */
export function defineAutoDispatch(opts: {
  vfs: ToolSpawnFn
  dlx: ToolSpawnFn
}): ToolSpawnFn {
  const { dlx, vfs } = opts
  return async (args, options, spawnExtra) => {
    if (isSeaBinary() && areExternalToolsAvailable()) {
      return await vfs(args, options, spawnExtra)
    }
    return await dlx(args, options, spawnExtra)
  }
}

/**
 * Build a npm-CLI-mode spawner for a tool that ships strictly via GitHub
 * releases (trufflehog, trivy, opengrep). Throws a clearly-attributed
 * resolver-contract error if the resolver returns a non-github-release type.
 */
export function defineGitHubReleaseSpawn(opts: {
  toolName: string
  resolve: () => BinaryResolution
}): ToolSpawnFn {
  const { resolve, toolName } = opts
  return async (args, options, spawnExtra) => {
    const resolution = resolve()

    if (resolution.type !== 'github-release') {
      throw new Error(
        `internal: resolve${capitalize(toolName)} returned resolution.type="${resolution.type}" (expected "github-release"); this is a resolver contract bug — re-run with --debug and report the output`,
      )
    }

    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const binaryPath = await downloadGitHubReleaseBinary(resolution.details)

    const spawnPromise = spawn(binaryPath, args, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
    })

    return { spawnPromise }
  }
}

/**
 * Build the full spawn-* triple for a pure-GitHub-release tool.
 *
 * Returns `{ Dlx, Vfs, auto }` where `auto` is the public spawnFoo() dispatcher
 * and Dlx/Vfs are the underlying spawners.
 */
export function defineToolSpawn(opts: {
  toolName: string
  vfsName: ExternalTool
  resolve: () => BinaryResolution
}): {
  Dlx: ToolSpawnFn
  Vfs: ToolSpawnFn
  auto: ToolSpawnFn
} {
  const Dlx = defineGitHubReleaseSpawn({
    toolName: opts.toolName,
    resolve: opts.resolve,
  })
  const Vfs = defineVfsSpawn(opts.vfsName)
  const auto = defineAutoDispatch({ vfs: Vfs, dlx: Dlx })
  return { Dlx, Vfs, auto }
}

/**
 * Build the standard SEA-mode VFS spawner for a tool.
 *
 * The VFS name (e.g. 'trufflehog') is the directory key under the SEA bundle.
 */
export function defineVfsSpawn(vfsName: ExternalTool): ToolSpawnFn {
  return async (args, options, spawnExtra) => {
    return await spawnToolVfs(vfsName, args, options, spawnExtra)
  }
}
