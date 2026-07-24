/**
 * @file Shared types + git/fs helpers for the git-partial-submodule CLI. Split
 *   out of `git-partial-submodule.mts` so the four subcommand implementations
 *   (-commands.mts) and the argparse CLI (the main file) both import this leaf
 *   layer without a cycle: internal ← commands ← cli. Ported from
 *   Reedbeta/git-partial-submodule (Apache-2.0).
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export const logger = getDefaultLogger()

export type CommonOpts = {
  dryRun: boolean
  verbose: boolean
}

export type AddOpts = CommonOpts & {
  branch: string | undefined
  name: string | undefined
  path: string
  repository: string
  sparse: boolean
}

export type CloneOpts = CommonOpts & {
  paths: string[]
}

export type SaveOrRestoreOpts = CommonOpts & {
  paths: string[]
}

export type Submodule = {
  branch?: string | undefined
  name: string
  path?: string | undefined
  'sparse-checkout'?: string | undefined
  url?: string | undefined
}

export type Gitmodules = {
  byName: Map<string, Submodule>
  byPath: Map<string, Submodule>
}

/**
 * Run git, exit non-zero on failure unless code is in `okReturnCodes`. Returns
 * the spawn result, or undefined on dry-run.
 */
export async function runGit(
  config: CommonOpts,
  gitArgs: string[],
  runOptions: { okReturnCodes?: number[] | undefined } = {},
): Promise<{ code: number | null } | undefined> {
  const cfg = { __proto__: null, ...config } as CommonOpts
  const okReturnCodes = runOptions.okReturnCodes ?? [0]
  if (cfg.verbose || cfg.dryRun) {
    logger.log(`git ${gitArgs.join(' ')}`)
  }
  if (cfg.dryRun) {
    return undefined
  }
  const result = await spawn('git', gitArgs, { stdio: 'inherit' })
  const code = result.code ?? 0
  if (!okReturnCodes.includes(code)) {
    logger.error(`Git command failed: git ${gitArgs.join(' ')}`)
    process.exit(1)
  }
  return { code }
}

/**
 * Run git, capture stdout. Ignores verbose / dry-run (query-only). Returns
 * trimmed stdout, or exits on non-OK return code.
 */
export async function readGitOutput(
  gitArgs: string[],
  options: { okReturnCodes?: number[] | undefined } = {},
): Promise<string> {
  const okReturnCodes = options.okReturnCodes ?? [0]
  const result = await spawn('git', gitArgs, {
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  const code = result.code ?? 0
  if (!okReturnCodes.includes(code)) {
    logger.error(`Git command failed: git ${gitArgs.join(' ')}`)
    process.exit(1)
  }
  return String(result.stdout ?? '')
}

export async function checkGitVersion(
  min: [number, number, number],
): Promise<void> {
  const out = await readGitOutput(['--version'])
  // Match `git version 2.43.0`: literal prefix then three `(\d+)` capture
  // groups (major, minor, patch) separated by escaped dots.
  const match = out.match(/git version (\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    logger.error(`Couldn't parse git version from: ${out.trim()}`)
    process.exit(1)
  }
  const have: [number, number, number] = [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ]
  if (
    have[0] < min[0] ||
    (have[0] === min[0] && have[1] < min[1]) ||
    (have[0] === min[0] && have[1] === min[1] && have[2] < min[2])
  ) {
    logger.error(
      `Git version is too old. You need at least ${min.join('.')}, and you have ${have.join('.')}.`,
    )
    process.exit(1)
  }
}

/**
 * Parse the .gitmodules file at <worktreeRoot>/.gitmodules.
 *
 * Format reminder: [submodule "<name>"] path = <path> url = <url> branch =
 * <branch> (optional) sparse-checkout = a b c (our extension; space-separated)
 */
export async function readGitmodules(
  config: CommonOpts,
  worktreeRoot: string,
): Promise<Gitmodules> {
  const cfg = { __proto__: null, ...config } as CommonOpts
  const gitmodulesPath = path.join(worktreeRoot, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    logger.error("Couldn't parse .gitmodules!")
    process.exit(1)
  }
  const raw = await fs.readFile(gitmodulesPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const byName = new Map<string, Submodule>()
  const byPath = new Map<string, Submodule>()
  let current: Submodule | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rawLine = lines[i]!
    // Strip inline comments (# or ;) — but not inside quoted strings;
    // .gitmodules section headers are `[submodule "<name>"]` so we strip
    // comments per-line after the section parse.
    const line = rawLine.split(/[#;]/)[0]!.trim()
    if (!line) {
      continue
    }
    const sectionMatch = line.match(/^\[submodule "(.+)"\]$/)
    if (sectionMatch) {
      const name = sectionMatch[1]!
      current = { name }
      byName.set(name, current)
      continue
    }
    if (!current) {
      continue
    }
    // Match a `key = value` .gitmodules line: group 1 `[\w-]+` is the key
    // (word chars + hyphen), then `=` with optional surrounding whitespace,
    // group 2 `(.*)` is the rest of the line as the value.
    const kvMatch = line.match(/^([\w-]+)\s*=\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]!
      const value = kvMatch[2]!
      ;(current as Record<string, unknown>)[key] = value
      if (key === 'path') {
        byPath.set(value, current)
      }
    }
  }
  if (cfg.verbose) {
    logger.log(`parsed ${byName.size} submodules from .gitmodules`)
  }
  return { byName, byPath }
}

/**
 * Resolve a user-supplied subpath into a worktree-relative posix path. Git
 * always uses forward slashes in submodule paths.
 */
export function toWorktreeRelative(
  worktreeRoot: string,
  input: string,
): string {
  const abs = path.resolve(input)
  return path.relative(worktreeRoot, abs).replaceAll(path.sep, '/')
}

export async function getRoots(): Promise<{
  repoRoot: string
  worktreeRoot: string
}> {
  const worktreeRoot = path.resolve(
    (await readGitOutput(['rev-parse', '--show-toplevel'])).trim(),
  )
  const repoRoot = path.resolve(
    (await readGitOutput(['rev-parse', '--git-dir'])).trim(),
  )
  return { repoRoot, worktreeRoot }
}

/**
 * Apply sparse-checkout patterns within a submodule worktree. Patterns are
 * split on whitespace (quoted paths are not yet supported).
 */
export async function applySparsePatterns(
  config: CommonOpts,
  submoduleWorktreeRoot: string,
  patterns: string,
): Promise<void> {
  await runGit(config, ['-C', submoduleWorktreeRoot, 'sparse-checkout', 'init'])
  await runGit(config, [
    '-C',
    submoduleWorktreeRoot,
    'sparse-checkout',
    'set',
    ...patterns.split(/\s+/).filter(Boolean),
  ])
}
