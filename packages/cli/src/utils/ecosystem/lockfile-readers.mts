/**
 * Lockfile registration + per-agent reader Map.
 *
 * Extracted from `environment.mts` to keep that file under the 1000-line
 * File-size cap. The `LOCKS` map names every lockfile filename Socket knows
 * about and the agent that owns it; `readLockFileByAgent` maps an Agent to
 * a reader that returns the lockfile contents (binary or utf8) — bun gets
 * a special reader that handles `.lockb` via the parser or shells out to
 * `bun bun.lockb` as a last resort.
 */

import path from 'node:path'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb/index.cjs'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { readFileBinary, readFileUtf8 } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  BUN,
  BUN_LOCK,
  BUN_LOCKB,
  NPM,
  NPM_SHRINKWRAP_JSON,
  PACKAGE_LOCK_JSON,
  PNPM,
  PNPM_LOCK_YAML,
  VLT,
  VLT_LOCK_JSON,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
} from '@socketsecurity/lib/constants/agents'
import {
  EXT_LOCK,
  EXT_LOCKB,
  NODE_MODULES,
} from '../../constants/packages.mts'

// `.package-lock.json` is the npm "hidden lockfile" name. Defined locally
// because @socketsecurity/lib doesn't export this constant.
const DOT_PACKAGE_LOCK_JSON = '.package-lock.json'

import type { Agent } from './environment.mts'

export type ReadLockFile =
  | ((lockPath: string) => Promise<string | Buffer | undefined>)
  | ((
      lockPath: string,
      agentExecPath: string,
    ) => Promise<string | Buffer | undefined>)
  | ((
      lockPath: string,
      agentExecPath: string,
      cwd: string,
    ) => Promise<string | Buffer | undefined>)

/**
 * Per-agent reader Map. Wraps each reader so any thrown error becomes
 * `undefined` — the caller treats that as "couldn't read this lockfile,
 * fall through" rather than aborting detection.
 */
export const readLockFileByAgent: Map<Agent, ReadLockFile> = (() => {
  function wrapReader<T extends (...args: any[]) => Promise<any>>(
    reader: T,
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | undefined> {
    return async (...args: any[]): Promise<any> => {
      try {
        return await reader(...args)
      } catch {}
      return undefined
    }
  }

  const binaryReader = wrapReader(readFileBinary)

  const defaultReader = wrapReader(
    async (lockPath: string) => await readFileUtf8(lockPath),
  )

  return new Map([
    [
      BUN,
      wrapReader(
        async (
          lockPath: string,
          agentExecPath: string,
          cwd = process.cwd(),
        ) => {
          const ext = path.extname(lockPath)
          if (ext === EXT_LOCK) {
            return await defaultReader(lockPath)
          }
          if (ext === EXT_LOCKB) {
            const lockBuffer = await binaryReader(lockPath)
            if (lockBuffer) {
              try {
                return parseBunLockb(lockBuffer)
              } catch {}
            }
            // To print a Yarn lockfile to your console without writing it to
            // disk use `bun bun.lockb`.
            // https://bun.sh/guides/install/yarnlock
            return (
              await spawn(agentExecPath, [lockPath], {
                cwd,
                // On Windows, bun is often a .cmd file that requires shell
                // execution. The spawn helper handles that when shell is true.
                shell: WIN32,
              })
            ).stdout
          }
          return undefined
        },
      ),
    ],
    [NPM, defaultReader],
    [PNPM, defaultReader],
    [VLT, defaultReader],
    [YARN_BERRY, defaultReader],
    [YARN_CLASSIC, defaultReader],
  ])
})()

/**
 * Lockfile filename → owning Agent. Iteration order is significant — keys
 * earlier in the object win when multiple lockfiles coexist. The hidden
 * `node_modules/.package-lock.json` is intentionally last (treated as a
 * fallback for repos that disable lockfile generation via `.npmrc`).
 */
export const LOCKS: Record<string, Agent> = {
  [BUN_LOCK]: BUN,
  [BUN_LOCKB]: BUN,
  // If both package-lock.json and npm-shrinkwrap.json are present at the root
  // of a project, npm-shrinkwrap.json takes precedence and package-lock.json
  // is ignored.
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson
  [NPM_SHRINKWRAP_JSON]: NPM,
  [PACKAGE_LOCK_JSON]: NPM,
  [PNPM_LOCK_YAML]: PNPM,
  [YARN_LOCK]: YARN_CLASSIC,
  [VLT_LOCK_JSON]: VLT,
  // Lastly, look for a hidden lockfile which is present if .npmrc has
  // package-lock=false:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#hidden-lockfiles
  //
  // Unlike the other LOCKS keys this key contains a directory AND filename
  // so it must be matched differently.
  [`${NODE_MODULES}/${DOT_PACKAGE_LOCK_JSON}`]: NPM,
}
