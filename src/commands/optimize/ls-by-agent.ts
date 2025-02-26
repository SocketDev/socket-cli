import spawn from '@npmcli/promise-spawn'

import constants from '../../constants'

import type { Agent } from '../../utils/package-manager-detector'

type AgentListDepsOptions = { npmExecPath?: string }

type AgentListDepsFn = (
  agentExecPath: string,
  cwd: string,
  options?: AgentListDepsOptions
) => Promise<string>

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

function parseableToQueryStdout(stdout: string) {
  if (stdout === '') {
    return ''
  }
  // Convert the parseable stdout into a json array of unique names.
  // The matchAll regexp looks for a forward (posix) or backward (win32) slash
  // and matches one or more non-slashes until the newline.
  const names = new Set(stdout.matchAll(/(?<=[/\\])[^/\\]+(?=\n)/g))
  return JSON.stringify([...names], null, 2)
}

async function npmQuery(npmExecPath: string, cwd: string): Promise<string> {
  let stdout = ''
  try {
    stdout = (await spawn(npmExecPath, ['query', ':not(.dev)'], { cwd })).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

async function lsBun(agentExecPath: string, cwd: string): Promise<string> {
  try {
    // Bun does not support filtering by production packages yet.
    // https://github.com/oven-sh/bun/issues/8283
    return (await spawn(agentExecPath!, ['pm', 'ls', '--all'], { cwd })).stdout
  } catch {}
  return ''
}

async function lsNpm(agentExecPath: string, cwd: string): Promise<string> {
  return await npmQuery(agentExecPath, cwd)
}

async function lsPnpm(
  agentExecPath: string,
  cwd: string,
  options?: AgentListDepsOptions
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
        agentExecPath,
        ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
        { cwd }
      )
    ).stdout
  } catch {}
  return parseableToQueryStdout(stdout)
}

async function lsVlt(agentExecPath: string, cwd: string): Promise<string> {
  let stdout = ''
  try {
    stdout = (
      await spawn(agentExecPath, ['ls', '--view', 'human', ':not(.dev)'], {
        cwd
      })
    ).stdout
  } catch {}
  return cleanupQueryStdout(stdout)
}

async function lsYarnBerry(
  agentExecPath: string,
  cwd: string
): Promise<string> {
  try {
    return (
      // Yarn Berry does not support filtering by production packages yet.
      // https://github.com/yarnpkg/berry/issues/5117
      (
        await spawn(agentExecPath, ['info', '--recursive', '--name-only'], {
          cwd
        })
      ).stdout.trim()
    )
  } catch {}
  return ''
}

async function lsYarnClassic(
  agentExecPath: string,
  cwd: string
): Promise<string> {
  try {
    // However, Yarn Classic does support it.
    // https://github.com/yarnpkg/yarn/releases/tag/v1.0.0
    // > Fix: Excludes dev dependencies from the yarn list output when the
    //   environment is production
    return (
      await spawn(agentExecPath, ['list', '--prod'], { cwd })
    ).stdout.trim()
  } catch {}
  return ''
}

export const lsByAgent: Record<Agent, AgentListDepsFn> = {
  // @ts-ignore
  __proto__: null,

  [BUN]: lsBun,
  [NPM]: lsNpm,
  [PNPM]: lsPnpm,
  [VLT]: lsVlt,
  [YARN_BERRY]: lsYarnBerry,
  [YARN_CLASSIC]: lsYarnClassic
}
