import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnDlx } from './spawn.mts'
import { resolveCoana } from './resolve-binary.mjs'

import { getDefaultOrgSlug } from '../../command/ci/fetch-default-org-slug.mjs'
import { getCliVersion } from '../../env/cli-version.mts'
import { getErrorCause } from '../error/errors.mts'

import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'
import { getCliUserAgent } from '../socket/user-agent.mts'
import { getExecPath } from '@socketsecurity/lib-stable/constants/node'

import type { CoanaDlxOptions, DlxSpawnResult } from './spawn.mts'
import type { CResult } from '../../types.mjs'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

export async function getCoanaEnvironment(
  orgSlug: string | undefined,
): Promise<Record<string, string>> {
  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: getCliVersion(),
    // Coana appends this to its own outbound User-Agent, so a Socket API
    // request that originated in a CLI-launched coana run is attributable to
    // the CLI version that launched it.
    SOCKET_CALLER_USER_AGENT: getCliUserAgent(),
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

  return mixinsEnv
}

export function getCoanaErrorMessage(e: unknown): string {
  const stderr = (e as { stderr?: string | undefined } | undefined)?.stderr
  const cause = getErrorCause(e)
  const message = stderr || cause

  return message
}

/**
 * Helper to spawn Coana with dlx.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export async function spawnCoana(
  args: string[] | readonly string[],
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    env: spawnEnv,
    orgSlug,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv = await getCoanaEnvironment(orgSlug)

  try {
    const resolution = resolveCoana()

    // Use local Coana CLI if available.
    if (resolution.type === 'local') {
      return await spawnLocalCoana(
        resolution.path,
        args,
        mixinsEnv,
        {
          ...dlxOptions,
          env: spawnEnv,
        },
        spawnExtra,
      )
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
        env: stripNpmPackageEnvVars({
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        }),
      },
      spawnExtra,
    )
    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
  } catch (e) {
    const message = getCoanaErrorMessage(e)
    return {
      ok: false,
      data: e,
      message,
    }
  }
}

export async function spawnLocalCoana(
  localPath: string,
  args: readonly string[],
  mixinsEnv: Record<string, string>,
  config: CoanaDlxOptions,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = { __proto__: null, ...config }
  const detection = detectExecutableType(localPath)

  const baseEnv = stripNpmPackageEnvVars({
    ...process.env,
    ...mixinsEnv,
    ...spawnEnv,
  })

  const nodeResolution = detection.type === 'binary' ? undefined : getExecPath()
  const spawnArgs = nodeResolution ? [localPath, ...args] : [...args]
  const spawnCommand = nodeResolution ?? localPath

  const spawnPromise = spawn(spawnCommand, spawnArgs, {
    ...dlxOptions,
    env: baseEnv,
    stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
  })

  const output = await spawnPromise

  return {
    ok: true,
    data: output.stdout?.toString() ?? '',
  }
}

/**
 * Drop npm-injected `npm_package_*` vars before spawning Coana. npm, pnpm, and
 * yarn classic populate one env var per leaf of the cwd's package.json —
 * `npm_package_dependencies_*`, `npm_package_scripts_*`, and so on. A monorepo
 * with hundreds of dependencies can spend 50KB+ of environment on them, which
 * pushes combined argv + env past Linux ARG_MAX (~128KB) and makes `spawn` fail
 * with E2BIG before Coana starts.
 *
 * Coana does not read `npm_package_*`. Everything else is kept — `npm_config_*`
 * in particular carries the registry, cache, and proxy settings a nested
 * install needs.
 */
export function stripNpmPackageEnvVars(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = Object.create(null)
  const keys = Object.keys(env)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (!key.startsWith('npm_package_')) {
      stripped[key] = env[key]
    }
  }
  return stripped
}
