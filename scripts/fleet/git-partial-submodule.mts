#!/usr/bin/env node
// max-file-lines: legitimate -- single-purpose CLI port; argparse + 4 subcommands; splitting fractures the flow

/**
 * @file Add / clone / save-sparse / restore-sparse partial submodules. Ported
 *   from Reedbeta/git-partial-submodule (Apache-2.0):
 *   https://github.com/Reedbeta/git-partial-submodule Lets the fleet declare a
 *   `sparse-checkout` field in `.gitmodules` and have partial clones
 *   (`--filter=blob:none --sparse`) honor it on init/clone. Vanilla `git
 *   submodule update` ignores the field; this script reads it. Usage: node
 *   scripts/fleet/git-partial-submodule.mts add [--branch B] [--name N]
 *   [--sparse] <url> <path> node scripts/fleet/git-partial-submodule.mts clone
 *   [path...] node scripts/fleet/git-partial-submodule.mts save-sparse
 *   [path...] node scripts/fleet/git-partial-submodule.mts restore-sparse
 *   [path...] Requires git >= 2.27 (--filter + --sparse on git clone).
 */

import { existsSync, mkdirSync, promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

type CommonOpts = {
  dryRun: boolean
  verbose: boolean
}

type AddOpts = CommonOpts & {
  branch: string | undefined
  name: string | undefined
  path: string
  repository: string
  sparse: boolean
}

type CloneOpts = CommonOpts & {
  paths: string[]
}

type SaveOrRestoreOpts = CommonOpts & {
  paths: string[]
}

type Submodule = {
  branch?: string | undefined
  name: string
  path?: string | undefined
  'sparse-checkout'?: string | undefined
  url?: string | undefined
}

type Gitmodules = {
  byName: Map<string, Submodule>
  byPath: Map<string, Submodule>
}

const USAGE = `git-partial-submodule — add / clone / save-sparse / restore-sparse partial submodules

Usage:
  git-partial-submodule [-n|--dry-run] [-v|--verbose] <command> [args]

Commands:
  add [--branch B] [--name N] [--sparse] <url> <path>
    Add a new partial submodule.
  clone [path...]
    Clone partial submodules from .gitmodules (all if no paths given).
  save-sparse [path...]
    Save sparse-checkout patterns to .gitmodules.
  restore-sparse [path...]
    Restore sparse-checkout patterns from .gitmodules.
`

/**
 * Run git, exit non-zero on failure unless code is in `okReturnCodes`. Returns
 * the spawn result, or undefined on dry-run.
 */
async function runGit(
  opts: CommonOpts,
  gitArgs: string[],
  options: { okReturnCodes?: number[] | undefined } = {},
): Promise<{ code: number | null } | undefined> {
  const okReturnCodes = options.okReturnCodes ?? [0]
  if (opts.verbose || opts.dryRun) {
    logger.log(`git ${gitArgs.join(' ')}`)
  }
  if (opts.dryRun) {
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
async function readGitOutput(
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

async function checkGitVersion(min: [number, number, number]): Promise<void> {
  const out = await readGitOutput(['--version'])
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
async function readGitmodules(
  opts: CommonOpts,
  worktreeRoot: string,
): Promise<Gitmodules> {
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
  for (const rawLine of lines) {
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
  if (opts.verbose) {
    logger.log(`parsed ${byName.size} submodules from .gitmodules`)
  }
  return { byName, byPath }
}

/**
 * Resolve a user-supplied subpath into a worktree-relative posix path. Git
 * always uses forward slashes in submodule paths.
 */
function toWorktreeRelative(worktreeRoot: string, input: string): string {
  const abs = path.resolve(input)
  return path.relative(worktreeRoot, abs).replaceAll(path.sep, '/')
}

async function getRoots(): Promise<{ repoRoot: string; worktreeRoot: string }> {
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
 * split on whitespace (TODO: support quoted paths).
 */
async function applySparsePatterns(
  opts: CommonOpts,
  submoduleWorktreeRoot: string,
  patterns: string,
): Promise<void> {
  await runGit(opts, ['-C', submoduleWorktreeRoot, 'sparse-checkout', 'init'])
  await runGit(opts, [
    '-C',
    submoduleWorktreeRoot,
    'sparse-checkout',
    'set',
    ...patterns.split(/\s+/).filter(Boolean),
  ])
}

async function cmdAdd(opts: AddOpts): Promise<void> {
  const { repoRoot, worktreeRoot } = await getRoots()
  if (opts.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const submoduleRelPath = toWorktreeRelative(worktreeRoot, opts.path)
  const submoduleName = opts.name ?? submoduleRelPath
  const submoduleRepoRoot = path.join(repoRoot, 'modules', submoduleName)
  if (existsSync(submoduleRepoRoot)) {
    logger.error(`submodule ${submoduleName} repo already exists!`)
    process.exit(1)
  }
  const submoduleWorktreeRoot = path.join(worktreeRoot, submoduleRelPath)
  if (
    existsSync(submoduleWorktreeRoot) &&
    readdirSync(submoduleWorktreeRoot).length > 0
  ) {
    logger.error(`${opts.path} submodule worktree is nonempty!`)
    process.exit(1)
  }
  const indexCheck = (
    await readGitOutput([
      '-C',
      worktreeRoot,
      'ls-files',
      '--cached',
      submoduleRelPath,
    ])
  ).trim()
  if (indexCheck) {
    logger.error(
      `${opts.path} submodule worktree is nonempty in the index!\n` +
        `You might need to \`git rm\` that directory first.`,
    )
    process.exit(1)
  }
  if (!opts.dryRun) {
    mkdirSync(path.dirname(submoduleRepoRoot), { recursive: true })
    mkdirSync(submoduleWorktreeRoot, { recursive: true })
  }
  await runGit(opts, [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--separate-git-dir',
    submoduleRepoRoot,
    ...(opts.branch ? ['--branch', opts.branch] : []),
    ...(opts.sparse ? ['--sparse'] : []),
    opts.repository,
    submoduleWorktreeRoot,
  ])
  await runGit(opts, [
    '-C',
    submoduleWorktreeRoot,
    'checkout',
    ...(opts.branch ? [opts.branch] : []),
  ])
  await runGit(opts, [
    '-C',
    submoduleWorktreeRoot,
    'config',
    'core.worktree',
    submoduleWorktreeRoot.replaceAll(path.sep, '/'),
  ])
  await runGit(opts, [
    '-C',
    worktreeRoot,
    'submodule',
    'add',
    ...(opts.branch ? ['-b', opts.branch] : []),
    ...(opts.name ? ['--name', opts.name] : []),
    opts.repository,
    submoduleRelPath,
  ])
}

async function cmdClone(opts: CloneOpts): Promise<void> {
  const { repoRoot, worktreeRoot } = await getRoots()
  if (opts.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const gitmodules = await readGitmodules(opts, worktreeRoot)
  await runGit(opts, ['submodule', 'init', ...opts.paths])
  const relPaths: string[] = opts.paths.length
    ? opts.paths.map(p => toWorktreeRelative(worktreeRoot, p))
    : [...gitmodules.byPath.keys()]
  let skipped = 0
  let processed = 0
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const submoduleRelPath = relPaths[i]!
    const submodule = gitmodules.byPath.get(submoduleRelPath)
    if (!submodule) {
      logger.error(
        `Couldn't find ${submoduleRelPath} in .gitmodules! Skipping.`,
      )
      skipped += 1
      continue
    }
    const submoduleRepoRoot = path.join(repoRoot, 'modules', submodule.name)
    if (
      existsSync(submoduleRepoRoot) &&
      readdirSync(submoduleRepoRoot).length > 0
    ) {
      if (opts.verbose) {
        logger.log(`submodule ${submodule.name} repo already exists; skipping`)
      }
      skipped += 1
      continue
    }
    const submoduleWorktreeRoot = path.join(worktreeRoot, submoduleRelPath)
    if (
      existsSync(submoduleWorktreeRoot) &&
      readdirSync(submoduleWorktreeRoot).length > 0
    ) {
      logger.error(
        `${submoduleRelPath} submodule worktree is nonempty! Skipping.`,
      )
      skipped += 1
      continue
    }
    if (!opts.dryRun) {
      mkdirSync(path.dirname(submoduleRepoRoot), { recursive: true })
      mkdirSync(submoduleWorktreeRoot, { recursive: true })
    }
    const url = submodule.url
    if (!url) {
      logger.error(`Submodule ${submodule.name} missing url; skipping`)
      skipped += 1
      continue
    }
    await runGit(opts, [
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      '--separate-git-dir',
      submoduleRepoRoot,
      ...(submodule.branch ? ['--branch', submodule.branch] : []),
      url,
      submoduleWorktreeRoot,
    ])
    const sparsePatterns = submodule['sparse-checkout']
    if (sparsePatterns) {
      await applySparsePatterns(opts, submoduleWorktreeRoot, sparsePatterns)
      logger.log(`Applied sparse-checkout patterns: ${sparsePatterns}`)
    }
    // Resolve the recorded gitlink sha to detach-checkout at.
    const treeInfo = (
      await readGitOutput([
        '-C',
        worktreeRoot,
        'ls-tree',
        'HEAD',
        submoduleRelPath,
      ])
    )
      .trim()
      .split(/\s+/)
    if (treeInfo.length !== 4) {
      logger.error('git ls-tree produced unexpected output:')
      logger.error(treeInfo.join(' '))
      process.exit(1)
    }
    const submoduleCommit = treeInfo[2]!
    if (opts.verbose) {
      logger.log(`${submodule.name} submodule sha1 is ${submoduleCommit}`)
    }
    let checkoutArgs: string[] = ['--detach', submoduleCommit]
    if (submodule.branch && !opts.dryRun) {
      const branchHeadCommit = (
        await readGitOutput([
          '-C',
          submoduleWorktreeRoot,
          'rev-parse',
          submodule.branch,
        ])
      ).trim()
      if (opts.verbose) {
        logger.log(
          `${submoduleRelPath} branch ${submodule.branch} is at sha1 ${branchHeadCommit}`,
        )
      }
      if (branchHeadCommit === submoduleCommit) {
        checkoutArgs = [submodule.branch]
      }
    }
    await runGit(opts, [
      '-C',
      submoduleWorktreeRoot,
      'checkout',
      ...checkoutArgs,
    ])
    await runGit(opts, [
      '-C',
      submoduleWorktreeRoot,
      'config',
      'core.worktree',
      submoduleWorktreeRoot.replaceAll(path.sep, '/'),
    ])
    processed += 1
  }
  logger.log(`Cloned ${processed} submodules and skipped ${skipped}.`)
}

async function cmdSaveSparse(opts: SaveOrRestoreOpts): Promise<void> {
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(opts, worktreeRoot)
  const relPaths: string[] = opts.paths.length
    ? opts.paths.map(p => toWorktreeRelative(worktreeRoot, p))
    : [...gitmodules.byPath.keys()]
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const submoduleRelPath = relPaths[i]!
    const submodule = gitmodules.byPath.get(submoduleRelPath)
    if (!submodule) {
      logger.error(
        `Couldn't find ${submoduleRelPath} in .gitmodules! Skipping.`,
      )
      continue
    }
    const submoduleWorktreeRoot = path.join(worktreeRoot, submoduleRelPath)
    if (
      !existsSync(submoduleWorktreeRoot) ||
      readdirSync(submoduleWorktreeRoot).length === 0
    ) {
      logger.error(`${submoduleRelPath} submodule worktree is empty! Skipping.`)
      continue
    }
    const sparseEnabled = (
      await readGitOutput(
        ['-C', submoduleWorktreeRoot, 'config', 'core.sparseCheckout'],
        { okReturnCodes: [0, 1] },
      )
    ).trim()
    if (sparseEnabled === 'true') {
      const sparsePatterns = (
        await readGitOutput([
          '-C',
          submoduleWorktreeRoot,
          'sparse-checkout',
          'list',
        ])
      ).trim()
      await runGit(opts, [
        '-C',
        worktreeRoot,
        'config',
        '-f',
        '.gitmodules',
        `submodule.${submodule.name}.sparse-checkout`,
        sparsePatterns.replaceAll('\n', ' '),
      ])
      logger.log(`Saved sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(
        opts,
        [
          '-C',
          worktreeRoot,
          'config',
          '-f',
          '.gitmodules',
          '--unset',
          `submodule.${submodule.name}.sparse-checkout`,
        ],
        { okReturnCodes: [0, 5] },
      )
      logger.log(`Sparse checkout not enabled for ${submodule.name}.`)
    }
  }
}

async function cmdRestoreSparse(opts: SaveOrRestoreOpts): Promise<void> {
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(opts, worktreeRoot)
  const relPaths: string[] = opts.paths.length
    ? opts.paths.map(p => toWorktreeRelative(worktreeRoot, p))
    : [...gitmodules.byPath.keys()]
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const submoduleRelPath = relPaths[i]!
    const submodule = gitmodules.byPath.get(submoduleRelPath)
    if (!submodule) {
      logger.error(
        `Couldn't find ${submoduleRelPath} in .gitmodules! Skipping.`,
      )
      continue
    }
    const submoduleWorktreeRoot = path.join(worktreeRoot, submoduleRelPath)
    if (
      !existsSync(submoduleWorktreeRoot) ||
      readdirSync(submoduleWorktreeRoot).length === 0
    ) {
      logger.error(`${submoduleRelPath} submodule worktree is empty! Skipping.`)
      continue
    }
    const sparsePatterns = submodule['sparse-checkout']
    if (sparsePatterns) {
      await applySparsePatterns(opts, submoduleWorktreeRoot, sparsePatterns)
      logger.log(`Applied sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(opts, [
        '-C',
        submoduleWorktreeRoot,
        'sparse-checkout',
        'disable',
      ])
      logger.log(`Sparse checkout disabled for ${submodule.name}.`)
    }
  }
}

function parseArgs(argv: string[]): {
  command: 'add' | 'clone' | 'help' | 'restore-sparse' | 'save-sparse'
  rest: string[]
  opts: CommonOpts
} {
  const opts: CommonOpts = { dryRun: false, verbose: false }
  const remaining: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--dry-run' || arg === '-n') {
      opts.dryRun = true
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      return { command: 'help', opts, rest: [] }
    } else {
      remaining.push(arg)
    }
  }
  if (remaining.length === 0) {
    return { command: 'help', opts, rest: [] }
  }
  const command = remaining.shift()!
  if (
    command !== 'add' &&
    command !== 'clone' &&
    command !== 'restore-sparse' &&
    command !== 'save-sparse'
  ) {
    logger.error(`Unknown command: ${command}`)
    return { command: 'help', opts, rest: [] }
  }
  return { command, opts, rest: remaining }
}

function parseAddArgs(common: CommonOpts, rest: string[]): AddOpts {
  let branch: string | undefined
  let name: string | undefined
  let sparse = false
  const positional: string[] = []
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!
    if (arg === '--branch' || arg === '-b') {
      branch = rest[++i]
    } else if (arg === '--name') {
      name = rest[++i]
    } else if (arg === '--sparse') {
      sparse = true
    } else {
      positional.push(arg)
    }
  }
  if (positional.length !== 2) {
    logger.error(
      `add requires <repository> <path>; got ${positional.length} positional args`,
    )
    process.exit(1)
  }
  return {
    ...common,
    branch,
    name,
    path: positional[1]!,
    repository: positional[0]!,
    sparse,
  }
}

async function main(): Promise<void> {
  // git >= 2.27 is required for `--filter` + `--sparse` on `git clone`.
  await checkGitVersion([2, 27, 0])

  const { command, opts, rest } = parseArgs(process.argv.slice(2))
  if (command === 'help') {
    logger.log(USAGE)
    return
  }
  if (opts.dryRun) {
    logger.log('DRY RUN:')
  }
  switch (command) {
    case 'add':
      await cmdAdd(parseAddArgs(opts, rest))
      return
    case 'clone':
      await cmdClone({ ...opts, paths: rest })
      return
    case 'save-sparse':
      await cmdSaveSparse({ ...opts, paths: rest })
      return
    case 'restore-sparse':
      await cmdRestoreSparse({ ...opts, paths: rest })
      return
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  logger.error(`git-partial-submodule: ${msg}`)
  process.exitCode = 1
})
