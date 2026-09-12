/**
 * Trusted resolution for the system tools the CLI spawns by name.
 *
 * A bare command name is resolved by a PATH lookup, and the CLI runs with its
 * working directory inside a repository it did not author. That checkout can
 * put a `node_modules/.bin` shim, a `.venv/bin` entry, or its own root on PATH
 * and win the lookup. Every tool the CLI expects to come from the system —
 * `git`, `node`, `tar`, `sbt` — is therefore resolved here rather than handed
 * to the child as a bare name.
 *
 * Key Functions:
 *
 * - FindSystemTool: Canonical executable outside the protected root, paired with
 *   the PATH the child is allowed to search. Memoized per tool, protected root,
 *   and PATH value.
 * - DescribeSystemToolFailure: The What / Where / Saw-vs-wanted / Fix message a
 *   caller raises when nothing resolves.
 * - BuildSystemToolEnv: Child environment with PATH replaced by the sanitized
 *   search path.
 *
 * Usage: resolve once per spawn site, spawn the absolute `executable`, and hand
 * the child `buildSystemToolEnv(env, searchPath)`. Spawning the absolute path
 * but forwarding the original PATH only moves the problem to the grandchildren.
 *
 * This is for tools that belong to the system. A repository-supplied wrapper —
 * `./gradlew`, `./mvnw` — lives inside the protected root by design and must
 * not be routed through here; resolution is strict and would refuse it.
 */

import process from 'node:process'

import {
  defaultProtectedRoot,
  findEnvPathValue,
  resolveTrustedExecutable,
} from '../trusted-executable.mts'

export type SystemToolFailureOptions = {
  cwd?: string | undefined
  /**
   * Sentence appended after the diagnosis telling the operator how to install
   * or point at the tool. Defaults to a generic install instruction.
   */
  installHint?: string | undefined
}

export type SystemToolOptions = {
  cwd?: string | undefined
  env?: Readonly<Record<string, string | undefined>> | undefined
}

export type SystemToolResolution = {
  /**
   * Canonical absolute path to an executable outside the protected root.
   */
  executable: string
  /**
   * PATH the child may search, with every poisoned entry already removed.
   */
  searchPath: string
}

const systemToolCache = new Map<string, SystemToolResolution>()

/**
 * Environment for a system-tool child with PATH replaced by the sanitized
 * search path.
 *
 * The key is deleted before it is re-added so a Windows environment spelling it
 * `Path` ends up with one PATH rather than two disagreeing ones.
 */
export function buildSystemToolEnv(
  env: Readonly<Record<string, string | undefined>>,
  searchPath: string,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...env }
  const names = Object.keys(result)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toUpperCase() === 'PATH') {
      delete result[name]
    }
  }
  result['PATH'] = searchPath
  return result
}

/**
 * Drop the memoized resolutions. Exists so a test can force a fresh resolution
 * against a new fixture.
 */
export function clearSystemToolCache(): void {
  systemToolCache.clear()
}

/**
 * Message for a tool that did not resolve outside the protected root.
 *
 * Recomputing the protected root here costs one directory walk on a path that
 * is already failing, and it keeps the successful path from carrying a value it
 * only needs when something goes wrong.
 */
export async function describeSystemToolFailure(
  toolName: string,
  options?: SystemToolFailureOptions | undefined,
): Promise<string> {
  const opts = { __proto__: null, ...options } as SystemToolFailureOptions
  const {
    cwd = process.cwd(),
    installHint = `Install ${toolName} outside the repository and put its directory on PATH.`,
  } = opts
  const protectedRoot = await defaultProtectedRoot(cwd)
  return (
    `Cannot resolve a trusted ${toolName} executable. ` +
    `Searched PATH from ${cwd}, treating ${protectedRoot} as an untrusted checkout. ` +
    `Every candidate was missing, not executable, or resolved inside that checkout; a ${toolName} outside it is required. ` +
    installHint
  )
}

/**
 * Canonical `toolName` outside the protected root, or undefined when nothing
 * runnable resolves there.
 *
 * Memoized on the tool name, the protected root, and the PATH value, so a later
 * spawn from a different checkout re-resolves rather than reusing a lookup that
 * a different repository influenced.
 */
export async function findSystemTool(
  toolName: string,
  options?: SystemToolOptions | undefined,
): Promise<SystemToolResolution | undefined> {
  const opts = { __proto__: null, ...options } as SystemToolOptions
  const { cwd = process.cwd(), env = process.env } = opts
  const protectedRoot = await defaultProtectedRoot(cwd)
  const cacheKey = `${toolName}\0${protectedRoot}\0${findEnvPathValue(env) ?? ''}`
  const cached = systemToolCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const trusted = await resolveTrustedExecutable(toolName, env, protectedRoot)
  if (!trusted) {
    return undefined
  }
  const resolution: SystemToolResolution = {
    executable: trusted.executable,
    searchPath: findEnvPathValue(trusted.environment) ?? '',
  }
  systemToolCache.set(cacheKey, resolution)
  return resolution
}
