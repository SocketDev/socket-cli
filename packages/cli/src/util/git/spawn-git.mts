/**
 * The single chokepoint every Socket CLI git invocation passes through.
 *
 * `socket fix` and `socket scan` run git with the current working directory set
 * to a repository the CLI did not author. That checkout owns its `.git/config`,
 * its hook directory, and — by way of `GITHUB_BASE_REF`, `GITHUB_REF_NAME`, and
 * `socket.json` — some of the branch names the CLI passes back to git. A plain
 * `spawn('git', …)` in that position hands an attacker four separate footguns:
 * a repository-local `git` shim on PATH, a `pre-commit` hook that fires during
 * the fix commit, an `ext::sh -c …` remote that executes on any network call,
 * and a branch name spelled `--upload-pack=…` that git parses as an option.
 *
 * Key Functions:
 *
 * - SpawnGit: Run git with the trusted executable, a scrubbed environment, the
 *   hygiene config prefix, and untrusted operands fenced behind
 *   `--end-of-options`.
 * - ResolveGitExecutable: Canonical git outside the protected root, paired with
 *   the sanitized PATH the child is allowed to search.
 * - ListGitHygieneArgs: The `-c` prefix applied to every invocation.
 * - BuildGitChildEnv: Environment with every `GIT_*` variable removed.
 *
 * Usage: never call `spawn('git', …)` directly. Put values the CLI controls in
 * `args` and values a repository or its environment controls in `operands`;
 * only `operands` is fenced, and only `args` may contain flags.
 */

import process from 'node:process'

import { isDebug } from '@socketsecurity/lib-stable/debug/namespace'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  defaultProtectedRoot,
  findEnvPathValue,
  resolveTrustedExecutable,
} from '../trusted-executable.mts'

import type {
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * The stdio shape `spawn` accepts, named so call sites can annotate it.
 */
export type GitStdio = NonNullable<SpawnOptions['stdio']>

export type GitExecutableResolution = {
  /**
   * Canonical absolute path to a git that lives outside the protected root.
   */
  executable: string
  /**
   * PATH the child may search, with every poisoned entry already removed.
   */
  searchPath: string
}

export type ResolveGitExecutableOptions = {
  cwd?: string | undefined
  env?: Readonly<Record<string, string | undefined>> | undefined
}

export type SpawnGitOptions = {
  cwd?: string | undefined
  env?: Readonly<Record<string, string | undefined>> | undefined
  /**
   * Values a repository, its environment, or its `socket.json` can influence —
   * refs, remote names, pathspecs, URLs. They are appended after
   * `--end-of-options` so git can never read one as a flag. Anything placed in
   * `args` instead is trusted to be a literal the CLI chose.
   */
  operands?: string[] | readonly string[] | undefined
  stdio?: GitStdio | undefined
}

/**
 * Fence between git's options and operands.
 *
 * Verified against git 2.50.1 for every subcommand the CLI runs — `add`,
 * `branch`, `branch -D`, `checkout`, `config`, `ls-remote`, `push`,
 * `push --delete`, `remote get-url`, `remote set-url`, `remote show`,
 * `reset --hard`, `rev-parse`, `show-ref`, `symbolic-ref`. Each one accepts the
 * flag and stops treating what follows as an option; `--` is not a substitute,
 * because `checkout` and `reset` read `--` as "pathspecs follow" and would
 * resolve a branch name as a file. Git has understood `--end-of-options` since
 * 2.24.
 */
export const GIT_OPERAND_FENCE = '--end-of-options'

/**
 * Repository-config overrides forced onto every invocation, highest precedence.
 *
 * - `core.fsmonitor=false` — the value may name a command git runs while
 *   refreshing the index.
 * - `core.hooksPath=` — the scanned repository's own `pre-commit`, `commit-msg`,
 *   and `post-checkout` hooks must not run during `socket fix`.
 * - `credential.helper=` — an empty value resets the helper chain, and because
 *   `-c` sorts last it drops a repository-supplied `!sh -c 'evil'` helper that
 *   would otherwise execute on any network operation.
 * - `protocol.allow=never` plus the five known-safe transports — unknown
 *   transports default to policy `user`, which counts a direct `ls-remote` as
 *   user-initiated. Denying by default and re-allowing exactly git's own
 *   known-safe set narrows that without changing behavior for real remotes.
 * - `protocol.ext.allow=never` — required on its own. A checkout that pairs an
 *   `ext::sh -c …` origin with `protocol.ext.allow = always` in its
 *   `.git/config` beats a bare `protocol.allow=never`, because the specific key
 *   outranks the generic one; only the specific key set here overrides it.
 */
const GIT_HYGIENE_CONFIG: readonly string[] = [
  'core.fsmonitor=false',
  'core.hooksPath=',
  'credential.helper=',
  'protocol.allow=never',
  'protocol.ext.allow=never',
  'protocol.file.allow=always',
  'protocol.git.allow=always',
  'protocol.http.allow=always',
  'protocol.https.allow=always',
  'protocol.ssh.allow=always',
]

const gitExecutableCache = new Map<string, GitExecutableResolution>()

/**
 * Environment for a git child: every `GIT_*` variable dropped, PATH replaced
 * with the sanitized search path, and terminal prompting disabled.
 *
 * Dropping the whole `GIT_*` namespace covers `GIT_DIR`, `GIT_WORK_TREE`,
 * `GIT_INDEX_FILE`, `GIT_CONFIG_*`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`,
 * `GIT_EXTERNAL_DIFF`, and `GIT_PAGER` in one rule, so a poisoned `.envrc` or
 * parent environment cannot redirect the child. `GIT_TERMINAL_PROMPT=0` is set
 * afterwards: without it a `ls-remote` or `push` running under `stdio:
 * 'ignore'` blocks forever on an invisible credential prompt.
 */
export function buildGitChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  searchPath: string,
): Record<string, string | undefined> {
  const result = omitGitEnvVars(env)
  const names = Object.keys(result)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toUpperCase() === 'PATH') {
      delete result[name]
    }
  }
  result['PATH'] = searchPath
  result['GIT_TERMINAL_PROMPT'] = '0'
  return result
}

/**
 * Drop the memoized git resolutions. Exists so a test can force a fresh
 * resolution against a new fixture.
 */
export function clearGitExecutableCache(): void {
  gitExecutableCache.clear()
}

/**
 * Stdio for a git command whose output is only interesting while debugging:
 * forwarded to the terminal under a debug namespace, discarded otherwise.
 */
export function gitQuietStdio(): GitStdio {
  return isDebug() ? 'inherit' : 'ignore'
}

/**
 * The invocation prefix shared by every git command.
 *
 * `--literal-pathspecs` stops a filename from smuggling pathspec magic such as
 * `:(exclude)` into `git add`. `--no-pager` keeps a repository-supplied
 * `core.pager` command from running when debug mode inherits a terminal.
 */
export function listGitHygieneArgs(): string[] {
  const args = ['--literal-pathspecs', '--no-pager']
  for (let i = 0, { length } = GIT_HYGIENE_CONFIG; i < length; i += 1) {
    args.push('-c', GIT_HYGIENE_CONFIG[i]!)
  }
  return args
}

/**
 * Copy `env` without any variable in the `GIT_*` namespace.
 */
export function omitGitEnvVars(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  const names = Object.keys(env)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toUpperCase().startsWith('GIT_')) {
      continue
    }
    result[name] = env[name]
  }
  return result
}

/**
 * Canonical git outside the protected root, memoized per protected root and
 * PATH value.
 *
 * @throws {Error} When no runnable git resolves outside the protected root.
 */
export async function resolveGitExecutable(
  options?: ResolveGitExecutableOptions | undefined,
): Promise<GitExecutableResolution> {
  const opts = {
    __proto__: null,
    ...options,
  } as ResolveGitExecutableOptions
  const { cwd = process.cwd(), env = process.env } = opts
  const protectedRoot = await defaultProtectedRoot(cwd)
  const cacheKey = `${protectedRoot}\0${findEnvPathValue(env) ?? ''}`
  const cached = gitExecutableCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const trusted = await resolveTrustedExecutable('git', env, protectedRoot)
  if (!trusted) {
    throw new Error(
      `Cannot resolve a trusted git executable. ` +
        `Searched PATH from ${cwd}, treating ${protectedRoot} as an untrusted checkout. ` +
        `Every candidate was missing, not executable, or resolved inside that checkout; a git outside it is required. ` +
        `Install git outside the repository (\`brew install git\`, \`apt install git\`) and put its directory on PATH.`,
    )
  }
  const resolution: GitExecutableResolution = {
    executable: trusted.executable,
    searchPath: findEnvPathValue(trusted.environment) ?? '',
  }
  gitExecutableCache.set(cacheKey, resolution)
  return resolution
}

/**
 * Run git through the trusted executable with the hygiene prefix applied.
 *
 * @throws {Error} When no trusted git resolves.
 * @throws {SpawnError} When git exits non-zero.
 */
export async function spawnGit(
  args: string[] | readonly string[],
  options?: SpawnGitOptions | undefined,
): Promise<Awaited<SpawnResult<string>>> {
  const opts = { __proto__: null, ...options } as SpawnGitOptions
  const { cwd = process.cwd(), env = process.env, operands, stdio } = opts
  const { executable, searchPath } = await resolveGitExecutable({ cwd, env })
  const argv = [...listGitHygieneArgs(), ...args]
  if (operands?.length) {
    argv.push(GIT_OPERAND_FENCE, ...operands)
  }
  return await spawn(executable, argv, {
    cwd,
    env: buildGitChildEnv(env, searchPath),
    ...(stdio === undefined ? {} : { stdio }),
  })
}
