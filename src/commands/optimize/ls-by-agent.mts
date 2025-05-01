import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'

import type { Agent, EnvDetails } from '../../utils/package-environment.mts'

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function cleanupQueryStdout(stdout: string): string {
  if (stdout === '') {
    return ''
  }
  let pkgs
  try {
    pkgs = JSON.parse(stdout)
  } catch {}
  if (!Array.isArray(pkgs)) {
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
  return JSON.stringify([...names], null, 2)
}

function parsableToQueryStdout(stdout: string) {
  if (stdout === '') {
    return ''
  }
  // Convert the parsable stdout into a json array of unique names.
  // The matchAll regexp looks for a forward (posix) or backward (win32) slash
  // and matches one or more non-slashes until the newline.
  const names = new Set(stdout.matchAll(/(?<=[/\\])[^/\\]+(?=\n)/g))
  return JSON.stringify([...names], null, 2)
}

async function npmQuery(npmExecPath: string, cwd: string): Promise<string> {
  let stdout = ''
  try {
    stdout = (
      await spawn(npmExecPath, ['query', ':not(.dev)'], {
        cwd,
        // Lazily access constants.WIN32.
        shell: constants.WIN32
      })
    ).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

async function lsBun(pkgEnvDetails: EnvDetails, cwd: string): Promise<string> {
  try {
    // Bun does not support filtering by production packages yet.
    // https://github.com/oven-sh/bun/issues/8283
    return (
      await spawn(pkgEnvDetails.agentExecPath, ['pm', 'ls', '--all'], {
        cwd,
        // Lazily access constants.WIN32.
        shell: constants.WIN32
      })
    ).stdout
  } catch {}
  return ''
}

async function lsNpm(pkgEnvDetails: EnvDetails, cwd: string): Promise<string> {
  return await npmQuery(pkgEnvDetails.agentExecPath, cwd)
}

async function lsPnpm(
  pkgEnvDetails: EnvDetails,
  cwd: string,
  options?: AgentListDepsOptions | undefined
): Promise<string> {
  const npmExecPath = options?.npmExecPath
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
          // Lazily access constants.WIN32.
          shell: constants.WIN32
        }
      )
    ).stdout
  } catch {}
  return parsableToQueryStdout(stdout)
}

async function lsVlt(pkgEnvDetails: EnvDetails, cwd: string): Promise<string> {
  let stdout = ''
  try {
    // See https://docs.vlt.sh/cli/commands/list#options.
    stdout = (
      await spawn(
        pkgEnvDetails.agentExecPath,
        ['ls', '--view', 'human', ':not(.dev)'],
        {
          cwd,
          // Lazily access constants.WIN32.
          shell: constants.WIN32
        }
      )
    ).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

async function lsYarnBerry(
  pkgEnvDetails: EnvDetails,
  cwd: string
): Promise<string> {
  try {
    return (
      // Yarn Berry does not support filtering by production packages yet.
      // https://github.com/yarnpkg/berry/issues/5117
      (
        await spawn(
          pkgEnvDetails.agentExecPath,
          ['info', '--recursive', '--name-only'],
          {
            cwd,
            // Lazily access constants.WIN32.
            shell: constants.WIN32
          }
        )
      ).stdout.trim()
    )
  } catch {}
  return ''
}

async function lsYarnClassic(
  pkgEnvDetails: EnvDetails,
  cwd: string
): Promise<string> {
  try {
    // However, Yarn Classic does support it.
    // https://github.com/yarnpkg/yarn/releases/tag/v1.0.0
    // > Fix: Excludes dev dependencies from the yarn list output when the
    //   environment is production
    return (
      await spawn(pkgEnvDetails.agentExecPath, ['list', '--prod'], {
        cwd,
        // Lazily access constants.WIN32.
        shell: constants.WIN32
      })
    ).stdout.trim()
  } catch {}
  return ''
}

export type AgentListDepsOptions = { npmExecPath?: string }

export type AgentListDepsFn = (
  pkgEnvDetails: EnvDetails,
  cwd: string,
  options?: AgentListDepsOptions | undefined
) => Promise<string>

export const lsByAgent = new Map<Agent, AgentListDepsFn>([
  [BUN, lsBun],
  [NPM, lsNpm],
  [PNPM, lsPnpm],
  [VLT, lsVlt],
  [YARN_BERRY, lsYarnBerry],
  [YARN_CLASSIC, lsYarnClassic]
])
