import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

import type { EnvDetails } from '../../utils/package-environment.mts'

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function cleanupQueryStdout(stdout: string): string {
  if (stdout === '') {
    return ''
  }
  let pkgs
  try {
    pkgs = JSON.parse(stdout)
  } catch {}
  if (!Array.isArray(pkgs) || !pkgs.length) {
    return ''
  }
  const names = new Set<string>()
  for (const { _id, name, pkgid } of pkgs) {
    // `npm query` results may not have a "name" property, in which case we
    // fallback to "_id" and then "pkgid".
    // `vlt ls --view json` results always have a "name" property.
    const fallback = _id ?? pkgid ?? ''
    const resolvedName = name ?? fallback.slice(0, fallback.indexOf('@', 1))
    // Add package names, except for those under the `@types` scope as those
    // are known to only be dev dependencies.
    if (resolvedName && !resolvedName.startsWith('@types/')) {
      names.add(resolvedName)
    }
  }
  return JSON.stringify(Array.from(names), null, 2)
}

function parsableToQueryStdout(stdout: string) {
  if (stdout === '') {
    return ''
  }
  // Convert the parsable stdout into a json array of unique names.
  // The matchAll regexp looks for a forward (posix) or backward (win32) slash
  // and matches one or more non-slashes until the newline.
  const names = new Set(stdout.matchAll(/(?<=[/\\])[^/\\]+(?=\n)/g))
  return JSON.stringify(Array.from(names), null, 2)
}

async function npmQuery(npmExecPath: string, cwd: string): Promise<string> {
  let stdout = ''
  try {
    stdout = (
      await spawn(npmExecPath, ['query', ':not(.dev)'], {
        cwd,
        shell: constants.WIN32,
      })
    ).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

export async function lsBun(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  try {
    // Bun does not support filtering by production packages yet.
    // https://github.com/oven-sh/bun/issues/8283
    return (
      await spawn(pkgEnvDetails.agentExecPath, ['pm', 'ls', '--all'], {
        cwd,
        shell: constants.WIN32,
      })
    ).stdout
  } catch {}
  return ''
}

export async function lsNpm(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  return await npmQuery(pkgEnvDetails.agentExecPath, cwd)
}

export async function lsPnpm(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd(), npmExecPath } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  if (npmExecPath && npmExecPath !== NPM) {
    const result = await npmQuery(npmExecPath, cwd)
    if (result) {
      return result
    }
  }
  let stdout = ''
  try {
    stdout = (
      await spawn(
        pkgEnvDetails.agentExecPath,
        // Pnpm uses the alternative spelling of parsable.
        // https://en.wiktionary.org/wiki/parsable
        ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
        {
          cwd,
          shell: constants.WIN32,
        },
      )
    ).stdout
  } catch {}
  return parsableToQueryStdout(stdout)
}

export async function lsVlt(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  let stdout = ''
  try {
    // See https://docs.vlt.sh/cli/commands/list#options.
    stdout = (
      await spawn(
        pkgEnvDetails.agentExecPath,
        ['ls', '--view', 'human', ':not(.dev)'],
        {
          cwd,
          shell: constants.WIN32,
        },
      )
    ).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

export async function lsYarnBerry(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  try {
    // Yarn Berry does not support filtering by production packages yet.
    // https://github.com/yarnpkg/berry/issues/5117
    return (
      await spawn(
        pkgEnvDetails.agentExecPath,
        ['info', '--recursive', '--name-only'],
        {
          cwd,
          shell: constants.WIN32,
        },
      )
    ).stdout
  } catch {}
  return ''
}

export async function lsYarnClassic(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options,
  } as AgentListDepsOptions
  try {
    // However, Yarn Classic does support it.
    // https://github.com/yarnpkg/yarn/releases/tag/v1.0.0
    // > Fix: Excludes dev dependencies from the yarn list output when the
    //   environment is production
    return (
      await spawn(pkgEnvDetails.agentExecPath, ['list', '--prod'], {
        cwd,
        shell: constants.WIN32,
      })
    ).stdout
  } catch {}
  return ''
}

export type AgentListDepsOptions = {
  cwd?: string | undefined
  npmExecPath?: string | undefined
}

export async function listPackages(
  pkgEnvDetails: EnvDetails,
  options?: AgentListDepsOptions | undefined,
): Promise<string> {
  switch (pkgEnvDetails.agent) {
    case BUN:
      return await lsBun(pkgEnvDetails, options)
    case PNPM:
      return await lsPnpm(pkgEnvDetails, options)
    case VLT:
      return await lsVlt(pkgEnvDetails, options)
    case YARN_BERRY:
      return await lsYarnBerry(pkgEnvDetails, options)
    case YARN_CLASSIC:
      return await lsYarnClassic(pkgEnvDetails, options)
    case NPM:
    default:
      return await lsNpm(pkgEnvDetails, options)
  }
}
