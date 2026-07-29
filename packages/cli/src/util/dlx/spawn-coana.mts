/**
 * Spawn Coana CLI for reachability analysis.
 *
 * - SpawnCoanaDlx: local override > Socket dlx download. Mixes Socket env vars
 *   (CLI version, API token, org slug, proxy) into the child env so Coana can
 *   call back to the Socket API.
 * - SpawnCoanaVfs: extract from SEA bundle, then exec.
 * - SpawnCoana: auto-detect SEA vs npm-CLI mode and dispatch.
 */

import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnDlx, spawnToolVfs } from './spawn.mts'
import { resolveCoana } from './resolve-binary.mjs'
import { areExternalToolsAvailable } from './vfs-extract.mjs'
import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mjs'
import { getCliVersion } from '../../env/cli-version.mts'
import { getErrorCause } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'
import { buildSystemToolEnv } from '../spawn/system-tool.mts'
import { resolveNodeExecutable } from '../spawn/spawn-node.mts'

import type { CoanaDlxOptions, DlxSpawnResult } from './spawn.mts'
import type { CResult } from '../../types.mjs'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Spawn Coana CLI. Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnCoana(
  args: string[] | readonly string[],
  orgSlug?: string | undefined,
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnCoanaVfs(args, options, spawnExtra)
  }
  return await spawnCoanaDlx(args, orgSlug, options, spawnExtra)
}

/**
 * Helper to spawn Coana with dlx.
 *
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export async function spawnCoanaDlx(
  args: string[] | readonly string[],
  orgSlug?: string | undefined,
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    env: spawnEnv,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: getCliVersion(),
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  if (orgSlug) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlug
  } else {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (orgSlugCResult.ok) {
      mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
    }
  }

  const proxyUrl = getDefaultProxyUrl()
  if (proxyUrl) {
    mixinsEnv['SOCKET_CLI_API_PROXY'] = proxyUrl
  }

  try {
    const resolution = resolveCoana()

    // Use local Coana CLI if available.
    if (resolution.type === 'local') {
      const detection = detectExecutableType(resolution.path)

      const baseEnv = {
        ...process.env,
        ...mixinsEnv,
        ...spawnEnv,
      }

      // A local override that is a JS file needs an interpreter, and a SEA
      // build has to find one on PATH; resolve it trustedly and pass the child
      // the sanitized PATH so its own lookups cannot reach back into the
      // checkout.
      const nodeResolution =
        detection.type === 'binary' ? undefined : await resolveNodeExecutable()
      const spawnArgs = nodeResolution ? [resolution.path, ...args] : [...args]
      const spawnCommand = nodeResolution?.executable ?? resolution.path

      const spawnPromise = spawn(spawnCommand, spawnArgs, {
        ...dlxOptions,
        env:
          nodeResolution?.searchPath === undefined
            ? baseEnv
            : buildSystemToolEnv(baseEnv, nodeResolution.searchPath),
        stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
      })

      const output = await spawnPromise

      return {
        ok: true,
        data: output.stdout?.toString() ?? '',
      }
    }

    // Use dlx version (resolveCoana only returns 'local' or 'dlx' types).
    if (resolution.type !== 'dlx') {
      throw new Error(
        `internal: resolveCoana returned resolution.type="${resolution.type}" (expected "dlx"); this is a resolver contract bug — re-run with --debug and report the output`,
      )
    }
    const result: DlxSpawnResult = await spawnDlx(
      {
        ...resolution.details,
        version: coanaVersion || resolution.details.version,
      },
      args,
      {
        force: true,
        ...dlxOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        },
      },
      spawnExtra,
    )
    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
  } catch (e) {
    const stderr = (e as { stderr?: string | undefined } | undefined)?.stderr
    const cause = getErrorCause(e)
    const message = stderr || cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}

/**
 * Helper to spawn Coana from VFS. Used when running in SEA mode.
 */
export async function spawnCoanaVfs(
  args: string[] | readonly string[],
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: getCliVersion(),
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  const orgSlugCResult = await getDefaultOrgSlug()
  if (orgSlugCResult.ok) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
  }

  const proxyUrl = getDefaultProxyUrl()
  if (proxyUrl) {
    mixinsEnv['SOCKET_CLI_API_PROXY'] = proxyUrl
  }

  try {
    const result = await spawnToolVfs(
      'coana',
      args,
      {
        ...dlxOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        },
      },
      spawnExtra,
    )

    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
  } catch (e) {
    const stderr = (e as { stderr?: string | undefined } | undefined)?.stderr
    const cause = getErrorCause(e)
    const message = stderr || cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}
