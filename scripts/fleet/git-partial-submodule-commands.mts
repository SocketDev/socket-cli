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
} from './git-partial-submodule-internal.mts'

export async function cmdAdd(opts: AddOpts): Promise<void> {
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

export async function cmdClone(opts: CloneOpts): Promise<void> {
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

export async function cmdSaveSparse(opts: SaveOrRestoreOpts): Promise<void> {
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

export async function cmdRestoreSparse(opts: SaveOrRestoreOpts): Promise<void> {
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
