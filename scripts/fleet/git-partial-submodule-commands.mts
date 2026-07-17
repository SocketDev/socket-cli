/**
 * @file The four git-partial-submodule subcommand implementations (add / clone
 *   / save-sparse / restore-sparse). Split out of `git-partial-submodule.mts`
 *   so the argparse CLI stays separate from the command bodies; both import the
 *   shared helpers from -internal.mts (no cycle: internal ← commands ← cli).
 *   Ported from Reedbeta/git-partial-submodule (Apache-2.0).
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  applySparsePatterns,
  getRoots,
  logger,
  readGitmodules,
  readGitOutput,
  runGit,
  toWorktreeRelative,
} from './git-partial-submodule-internal.mts'
import type {
  AddOpts,
  CloneOpts,
  SaveOrRestoreOpts,
  Submodule,
} from './git-partial-submodule-internal.mts'

// The `git clone --filter=blob:none --no-checkout --separate-git-dir …` argv
// for `cmdAdd`'s initial partial clone into the submodule's private repo dir.
export function buildAddCloneArgs(
  options: Pick<AddOpts, 'branch' | 'repository' | 'sparse'>,
  submoduleRepoRoot: string,
  submoduleWorktreeRoot: string,
): string[] {
  return [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--separate-git-dir',
    submoduleRepoRoot,
    ...(options.branch ? ['--branch', options.branch] : []),
    ...(options.sparse ? ['--sparse'] : []),
    options.repository,
    submoduleWorktreeRoot,
  ]
}

// The `git clone` argv for `cmdClone`'s per-submodule partial clone; sparse
// patterns (if any) are applied afterward via applySparsePatterns.
export function buildSubmoduleCloneArgs(
  submodule: Pick<Submodule, 'branch'>,
  url: string,
  submoduleRepoRoot: string,
  submoduleWorktreeRoot: string,
): string[] {
  return [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--separate-git-dir',
    submoduleRepoRoot,
    ...(submodule.branch ? ['--branch', submodule.branch] : []),
    url,
    submoduleWorktreeRoot,
  ]
}

// `git -C <dir> checkout [<branch>]` argv, shared by cmdAdd's post-clone step.
export function buildCheckoutArgs(
  submoduleWorktreeRoot: string,
  branch: string | undefined,
): string[] {
  return ['-C', submoduleWorktreeRoot, 'checkout', ...(branch ? [branch] : [])]
}

// The detach-vs-branch decision for `cmdClone`'s post-clone checkout: detach
// at the recorded gitlink sha, unless the submodule's tracked branch already
// resolves to that same commit — then check out the branch by name so the
// worktree stays on a branch ref instead of detached HEAD.
export function decideCloneCheckoutArgs(
  branch: string | undefined,
  submoduleCommit: string,
  branchHeadCommit: string | undefined,
): string[] {
  if (branch && branchHeadCommit === submoduleCommit) {
    return [branch]
  }
  return ['--detach', submoduleCommit]
}

// `git -C <dir> config core.worktree <dir>` argv, shared by cmdAdd + cmdClone.
export function buildCoreWorktreeConfigArgs(
  submoduleWorktreeRoot: string,
): string[] {
  return [
    '-C',
    submoduleWorktreeRoot,
    'config',
    'core.worktree',
    submoduleWorktreeRoot.replaceAll(path.sep, '/'),
  ]
}

// `git -C <worktreeRoot> submodule add …` argv for cmdAdd's final step.
export function buildSubmoduleAddArgs(
  options: Pick<AddOpts, 'branch' | 'name' | 'repository'>,
  worktreeRoot: string,
  submoduleRelPath: string,
): string[] {
  return [
    '-C',
    worktreeRoot,
    'submodule',
    'add',
    ...(options.branch ? ['-b', options.branch] : []),
    ...(options.name ? ['--name', options.name] : []),
    options.repository,
    submoduleRelPath,
  ]
}

// `git config -f .gitmodules submodule.<name>.sparse-checkout <patterns>`
// set / unset argv for cmdSaveSparse.
export function buildSaveSparseSetArgs(
  worktreeRoot: string,
  submoduleName: string,
  sparsePatternsOneLine: string,
): string[] {
  return [
    '-C',
    worktreeRoot,
    'config',
    '-f',
    '.gitmodules',
    `submodule.${submoduleName}.sparse-checkout`,
    sparsePatternsOneLine,
  ]
}

export function buildSaveSparseUnsetArgs(
  worktreeRoot: string,
  submoduleName: string,
): string[] {
  return [
    '-C',
    worktreeRoot,
    'config',
    '-f',
    '.gitmodules',
    '--unset',
    `submodule.${submoduleName}.sparse-checkout`,
  ]
}

// `git -C <dir> sparse-checkout disable` argv for cmdRestoreSparse.
export function buildSparseCheckoutDisableArgs(
  submoduleWorktreeRoot: string,
): string[] {
  return ['-C', submoduleWorktreeRoot, 'sparse-checkout', 'disable']
}

export async function cmdAdd(options: AddOpts): Promise<void> {
  options = { __proto__: null, ...options } as AddOpts
  const { repoRoot, worktreeRoot } = await getRoots()
  if (options.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const submoduleRelPath = toWorktreeRelative(worktreeRoot, options.path)
  const submoduleName = options.name ?? submoduleRelPath
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
    logger.error(`${options.path} submodule worktree is nonempty!`)
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
      `${options.path} submodule worktree is nonempty in the index!\n` +
        `You might need to \`git rm\` that directory first.`,
    )
    process.exit(1)
  }
  if (!options.dryRun) {
    mkdirSync(path.dirname(submoduleRepoRoot), { recursive: true })
    mkdirSync(submoduleWorktreeRoot, { recursive: true })
  }
  await runGit(
    options,
    buildAddCloneArgs(options, submoduleRepoRoot, submoduleWorktreeRoot),
  )
  await runGit(
    options,
    buildCheckoutArgs(submoduleWorktreeRoot, options.branch),
  )
  await runGit(options, buildCoreWorktreeConfigArgs(submoduleWorktreeRoot))
  await runGit(
    options,
    buildSubmoduleAddArgs(options, worktreeRoot, submoduleRelPath),
  )
}

export async function cmdClone(options: CloneOpts): Promise<void> {
  options = { __proto__: null, ...options } as CloneOpts
  const { repoRoot, worktreeRoot } = await getRoots()
  if (options.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const gitmodules = await readGitmodules(options, worktreeRoot)
  await runGit(options, ['submodule', 'init', ...options.paths])
  const relPaths: string[] = options.paths.length
    ? options.paths.map(p => toWorktreeRelative(worktreeRoot, p))
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
      if (options.verbose) {
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
    if (!options.dryRun) {
      mkdirSync(path.dirname(submoduleRepoRoot), { recursive: true })
      mkdirSync(submoduleWorktreeRoot, { recursive: true })
    }
    const url = submodule.url
    if (!url) {
      logger.error(`Submodule ${submodule.name} missing url; skipping`)
      skipped += 1
      continue
    }
    await runGit(
      options,
      buildSubmoduleCloneArgs(
        submodule,
        url,
        submoduleRepoRoot,
        submoduleWorktreeRoot,
      ),
    )
    const sparsePatterns = submodule['sparse-checkout']
    if (sparsePatterns) {
      await applySparsePatterns(options, submoduleWorktreeRoot, sparsePatterns)
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
    if (options.verbose) {
      logger.log(`${submodule.name} submodule sha1 is ${submoduleCommit}`)
    }
    let branchHeadCommit: string | undefined
    if (submodule.branch && !options.dryRun) {
      branchHeadCommit = (
        await readGitOutput([
          '-C',
          submoduleWorktreeRoot,
          'rev-parse',
          submodule.branch,
        ])
      ).trim()
      if (options.verbose) {
        logger.log(
          `${submoduleRelPath} branch ${submodule.branch} is at sha1 ${branchHeadCommit}`,
        )
      }
    }
    const checkoutArgs = decideCloneCheckoutArgs(
      submodule.branch,
      submoduleCommit,
      branchHeadCommit,
    )
    await runGit(options, [
      '-C',
      submoduleWorktreeRoot,
      'checkout',
      ...checkoutArgs,
    ])
    await runGit(options, buildCoreWorktreeConfigArgs(submoduleWorktreeRoot))
    processed += 1
  }
  logger.log(`Cloned ${processed} submodules and skipped ${skipped}.`)
}

export async function cmdSaveSparse(options: SaveOrRestoreOpts): Promise<void> {
  options = { __proto__: null, ...options } as SaveOrRestoreOpts
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(options, worktreeRoot)
  const relPaths: string[] = options.paths.length
    ? options.paths.map(p => toWorktreeRelative(worktreeRoot, p))
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
      await runGit(
        options,
        buildSaveSparseSetArgs(
          worktreeRoot,
          submodule.name,
          sparsePatterns.replaceAll('\n', ' '),
        ),
      )
      logger.log(`Saved sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(
        options,
        buildSaveSparseUnsetArgs(worktreeRoot, submodule.name),
        { okReturnCodes: [0, 5] },
      )
      logger.log(`Sparse checkout not enabled for ${submodule.name}.`)
    }
  }
}

export async function cmdRestoreSparse(
  options: SaveOrRestoreOpts,
): Promise<void> {
  options = { __proto__: null, ...options } as SaveOrRestoreOpts
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(options, worktreeRoot)
  const relPaths: string[] = options.paths.length
    ? options.paths.map(p => toWorktreeRelative(worktreeRoot, p))
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
      await applySparsePatterns(options, submoduleWorktreeRoot, sparsePatterns)
      logger.log(`Applied sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(
        options,
        buildSparseCheckoutDisableArgs(submoduleWorktreeRoot),
      )
      logger.log(`Sparse checkout disabled for ${submodule.name}.`)
    }
  }
}
