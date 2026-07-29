/**
 * PATH-trust-inverting executable resolution.
 *
 * The CLI routinely runs inside a repository checkout it did not author, so
 * PATH is attacker-influenced: a hostile checkout can ship `./bin/git`,
 * `node_modules/.bin/python`, or a `.venv/bin` shim and have a plain
 * `spawn('git')` pick it up. This module inverts the usual trust assumption —
 * anything that canonicalizes INSIDE the protected root is untrusted, and a
 * PATH entry that produced such a hit is dropped from the environment handed
 * to the child.
 *
 * Key Functions:
 *
 * - resolveTrustedExecutable: Resolve a command name (or literal path) to a
 *   canonical executable outside the protected root, paired with an
 *   environment whose PATH has every poisoned entry removed.
 * - defaultProtectedRoot: The outermost `.git`-marked ancestor of a directory,
 *   so a nested worktree cannot escape protection by way of its parent.
 * - listExecutableProbes: The per-platform suffix table probed for a bare
 *   command name.
 * - isPathWithinRoot: Containment test used for every trust decision.
 *
 * Usage: Resolve once per spawn site, then spawn the returned absolute
 * `executable` with the returned `environment` — never the bare name, which
 * would re-consult the child's own PATH and undo the sanitization.
 */

import { constants as fsConstants, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

export type ExecutableProbe = {
  runnable: boolean
  suffix: string
}

export type TrustedExecutable = {
  environment: Record<string, string | undefined>
  executable: string
}

export type TrustedExecutableOptions = {
  /**
   * Treat the host as Windows. Defaults to the real platform; an explicit
   * value exists so the Windows probe table and the F_OK accessibility check
   * are exercisable from a POSIX test run.
   */
  windows?: boolean | undefined
}

// A Windows candidate that already carries an executable suffix must not have
// a second one appended (`python.exe` -> `python.exe.exe`).
// require-regex-comment: trailing Windows executable suffix, case-insensitive.
const WINDOWS_EXECUTABLE_SUFFIX_RE = /\.(?:exe|com)$/iu

/**
 * Resolve a path to its canonical form, or undefined when it does not resolve.
 */
export async function canonicalizePath(
  target: string,
): Promise<string | undefined> {
  try {
    return await fs.realpath(target)
  } catch {
    return undefined
  }
}

/**
 * The outermost `.git`-marked ancestor of `cwd` (realpathed), falling back to
 * the realpath of `cwd` itself.
 *
 * Walking to the OUTERMOST marker rather than the nearest one matters for
 * nested checkouts: protecting only the inner worktree would leave the parent
 * repository's `node_modules/.bin` trusted, which is the exact escape hatch a
 * hostile nested repository would use.
 */
export async function defaultProtectedRoot(cwd: string): Promise<string> {
  const start = (await canonicalizePath(cwd)) ?? path.resolve(cwd)
  const { root } = path.parse(start)
  let outermost: string | undefined
  let dir = start
  // Check the starting directory itself before ascending, so a checkout root
  // passed directly still matches.
  do {
    // A `.git` marker is a directory in a normal clone and a file in a
    // worktree or submodule; either proves a repository boundary.
    if (existsSync(path.join(dir, '.git'))) {
      outermost = dir
    }
    if (dir === root) {
      break
    }
    dir = path.dirname(dir)
  } while (dir)
  return outermost ?? start
}

/**
 * Locate the PATH value in an environment, matching the key case-insensitively
 * because Windows spells it `Path`.
 */
export function findEnvPathValue(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const names = Object.keys(env)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toUpperCase() === 'PATH') {
      return env[name]
    }
  }
  return undefined
}

/**
 * Whether `target` is `root` itself or lives beneath it. Both arguments are
 * expected to be canonical (realpathed) absolute paths.
 */
export function isPathWithinRoot(root: string, target: string): boolean {
  const relativePath = path.relative(root, target)
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}

/**
 * The suffix table probed for a bare command name.
 *
 * On Windows the `.bat`, `.cmd`, and extensionless entries are marked
 * unrunnable: `execFile` cannot launch a batch file, so they can never be
 * selected. They are probed anyway because a hit still proves the PATH entry
 * is attacker-reachable, and a poisoned entry must be stripped from the child
 * environment even when the eventual winner came from somewhere else.
 */
export function listExecutableProbes(
  candidate: string,
  options?: TrustedExecutableOptions | undefined,
): ExecutableProbe[] {
  const opts = { __proto__: null, ...options } as TrustedExecutableOptions
  const { windows = WIN32 } = opts
  if (!windows || WINDOWS_EXECUTABLE_SUFFIX_RE.test(candidate)) {
    return [{ runnable: true, suffix: '' }]
  }
  return [
    { runnable: true, suffix: '.exe' },
    { runnable: true, suffix: '.com' },
    { runnable: false, suffix: '.bat' },
    { runnable: false, suffix: '.cmd' },
    { runnable: false, suffix: '' },
  ]
}

/**
 * Resolve `candidate` to a canonical executable that lives outside
 * `protectedRoot`, paired with a sanitized copy of `env`.
 *
 * Returns undefined when nothing runnable resolves outside the protected root.
 *
 * A PATH entry is dropped up front when it is empty, relative, or does not
 * resolve, and when its realpath lands inside the protected root — a hostile
 * checkout's `./bin` cannot contribute a lookup directory. A surviving entry
 * is dropped from the returned PATH when probing it produced a hit inside the
 * protected root, because a directory holding a repository-linked shim is
 * unsafe for the child to search on its own.
 */
export async function resolveTrustedExecutable(
  candidate: string,
  env: Readonly<Record<string, string | undefined>>,
  protectedRoot: string,
  options?: TrustedExecutableOptions | undefined,
): Promise<TrustedExecutable | undefined> {
  const opts = { __proto__: null, ...options } as TrustedExecutableOptions
  const { windows = WIN32 } = opts
  const root =
    (await canonicalizePath(protectedRoot)) ?? path.resolve(protectedRoot)

  const pathValue = findEnvPathValue(env)
  const rawEntries = pathValue ? pathValue.split(path.delimiter) : []
  const entries: string[] = []
  for (let i = 0, { length } = rawEntries; i < length; i += 1) {
    const rawEntry = rawEntries[i]!
    if (!rawEntry.length || !path.isAbsolute(rawEntry)) {
      continue
    }
    const canonical = await canonicalizePath(rawEntry)
    if (canonical === undefined || isPathWithinRoot(root, canonical)) {
      continue
    }
    if (!entries.includes(canonical)) {
      entries.push(canonical)
    }
  }

  const probes = listExecutableProbes(candidate, { windows })
  // A candidate carrying a separator is a literal path, not a PATH lookup, so
  // it is never attributed to a PATH entry.
  const isPathLike = candidate.includes('/') || candidate.includes('\\')
  const lookups: Array<{
    entry: string | undefined
    runnable: boolean
    target: string
  }> = []
  if (isPathLike) {
    lookups.push({
      entry: undefined,
      runnable: true,
      target: path.resolve(candidate),
    })
  } else {
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      for (
        let j = 0, { length: probeCount } = probes;
        j < probeCount;
        j += 1
      ) {
        const probe = probes[j]!
        lookups.push({
          entry,
          runnable: probe.runnable,
          target: path.join(entry, `${candidate}${probe.suffix}`),
        })
      }
    }
  }

  const unsafeEntries = new Set<string>()
  let executable: string | undefined
  for (let i = 0, { length } = lookups; i < length; i += 1) {
    const lookup = lookups[i]!
    const canonical = await canonicalizePath(lookup.target)
    if (canonical === undefined) {
      continue
    }
    if (isPathWithinRoot(root, canonical)) {
      // The hit itself is rejected AND its lookup directory is poisoned: a
      // directory that can serve a repository-linked binary is not a
      // directory the child should be allowed to search.
      if (lookup.entry !== undefined) {
        unsafeEntries.add(lookup.entry)
      }
      continue
    }
    // Keep scanning after a winner is found: a later probe may still poison a
    // PATH entry that has to leave the sanitized environment.
    if (!lookup.runnable || executable !== undefined) {
      continue
    }
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- probes the exec bit (X_OK); existsSync cannot express a permission check.
      await fs.access(canonical, windows ? fsConstants.F_OK : fsConstants.X_OK)
      // oxlint-disable-next-line socket/prefer-exists-sync -- reads .isFile() metadata to reject directories and devices, not existence.
      const stats = await fs.stat(canonical)
      if (stats.isFile()) {
        executable = canonical
      }
    } catch {}
  }
  if (executable === undefined) {
    return undefined
  }

  const environment: Record<string, string | undefined> = { ...env }
  const names = Object.keys(environment)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toUpperCase() === 'PATH') {
      delete environment[name]
    }
  }
  environment['PATH'] = entries
    .filter(entry => !unsafeEntries.has(entry))
    .join(path.delimiter)
  return { environment, executable }
}
