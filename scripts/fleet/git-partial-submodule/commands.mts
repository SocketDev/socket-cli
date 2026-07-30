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

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  applySparsePatterns,
  getRoots,
  logger,
  readGitmodules,
  readGitOutput,
  runGit,
  toWorktreeRelative,
} from './internal.mts'
import type {
  AddOpts,
  CloneOpts,
  SaveOrRestoreOpts,
  Submodule,
} from './internal.mts'

// The `git clone --filter=blob:none --no-checkout --separate-git-dir …` argv
// for `cmdAdd`'s initial partial clone into the submodule's private repo dir.
export function buildAddCloneArgs(
  config: Pick<AddOpts, 'branch' | 'repository' | 'sparse'>,
  submoduleRepoRoot: string,
  submoduleWorktreeRoot: string,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    '--separate-git-dir',
    submoduleRepoRoot,
    ...(cfg.branch ? ['--branch', cfg.branch] : []),
    ...(cfg.sparse ? ['--sparse'] : []),
    cfg.repository,
    submoduleWorktreeRoot,
  ]
}

// The `git clone` argv for `cmdClone`'s per-submodule partial clone; sparse
// patterns, if any, are applied afterward via applySparsePatterns.
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

// Git's index mode for a gitlink — a submodule entry recording another repo's
// commit inside the superproject's tree.
const GITLINK_MODE = '160000'

/**
 * Parse `git ls-files --stage` output into a path → gitlink-sha map, keeping
 * only `160000` entries. Each line is `<mode> <sha> <stage>\t<path>`; a regular
 * file line carries a blob mode and is dropped.
 *
 * This is what tells a gitlink-BACKED submodule apart from a gitlink-LESS
 * reference. The fleet forbids tracking an `upstream/` gitlink, so those paths
 * are absent from the index entirely.
 */
export function parseStagedGitlinks(
  lsFilesOutput: string,
): Map<string, string> {
  const out = new Map<string, string>()
  const lines = lsFilesOutput.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const tab = line.indexOf('\t')
    if (tab < 0) {
      continue
    }
    const fields = line.slice(0, tab).split(/\s+/)
    if (fields[0] !== GITLINK_MODE || !fields[1]) {
      continue
    }
    out.set(line.slice(tab + 1), fields[1])
  }
  return out
}

/**
 * The commit a materialization checks out. The `.gitmodules` `ref` field wins:
 * under the no-gitlink doctrine it IS the pin of record, and a gitlink-less
 * reference has nothing else. A submodule that predates the doctrine and still
 * carries a tracked `160000` entry falls back to that sha. Returns undefined
 * when neither exists, which the caller reports as an unresolvable pin.
 */
export function resolvePinnedCommit(
  submodule: Pick<Submodule, 'ref'>,
  gitlinkSha: string | undefined,
): string | undefined {
  return submodule.ref?.trim() || gitlinkSha
}

// The detach-vs-branch decision for `cmdClone`'s post-clone checkout: detach
// at the pinned commit, unless the submodule's tracked branch already
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

/**
 * True when a worktree-relative path is a fleet `upstream/<name>` reference.
 * `git submodule add` stages a `160000` gitlink, which the no-gitlink doctrine
 * forbids for these paths, so `add` refuses them and points at the
 * declare-then- materialize route instead.
 */
export function isUpstreamReferencePath(submoduleRelPath: string): boolean {
  const p = normalizePath(submoduleRelPath)
  return p === 'upstream' || p.startsWith('upstream/')
}

// `git -C <worktreeRoot> submodule add …` argv for cmdAdd's final step.
export function buildSubmoduleAddArgs(
  config: Pick<AddOpts, 'branch' | 'name' | 'repository'>,
  worktreeRoot: string,
  submoduleRelPath: string,
): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    '-C',
    worktreeRoot,
    'submodule',
    'add',
    ...(cfg.branch ? ['-b', cfg.branch] : []),
    ...(cfg.name ? ['--name', cfg.name] : []),
    cfg.repository,
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

export async function cmdAdd(config: AddOpts): Promise<void> {
  config = { __proto__: null, ...config } as AddOpts
  const { repoRoot, worktreeRoot } = await getRoots()
  if (config.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const submoduleRelPath = toWorktreeRelative(worktreeRoot, config.path)
  if (isUpstreamReferencePath(submoduleRelPath)) {
    logger.error(
      `Refusing to \`submodule add\` an upstream reference at ${submoduleRelPath}.\n` +
        `  Where: ${worktreeRoot}\n` +
        `  Saw:   an \`upstream/<name>\` path; wanted: a path the fleet tracks a gitlink for.\n` +
        `  Why:   \`git submodule add\` stages a 160000 gitlink, and the \`.gitmodules\`\n` +
        `         \`ref\` + \`sha256:\` ARE the pin — the gitlink is a redundant second copy.\n` +
        `  Fix:   declare the block, then materialize it —\n` +
        `           git config -f .gitmodules submodule.${submoduleRelPath}.path ${submoduleRelPath}\n` +
        `           git config -f .gitmodules submodule.${submoduleRelPath}.url ${config.repository}\n` +
        `           node scripts/fleet/gen/gitmodules-hash.mts --set ${submoduleRelPath} <ref> --label <name>-<version>\n` +
        `           node scripts/fleet/git-partial-submodule.mts clone ${submoduleRelPath}`,
    )
    process.exit(1)
  }
  const submoduleName = config.name ?? submoduleRelPath
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
    logger.error(`${config.path} submodule worktree is nonempty!`)
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
      `${config.path} submodule worktree is nonempty in the index!\n` +
        `You might need to \`git rm\` that directory first.`,
    )
    process.exit(1)
  }
  if (!config.dryRun) {
    mkdirSync(path.dirname(submoduleRepoRoot), { recursive: true })
    mkdirSync(submoduleWorktreeRoot, { recursive: true })
  }
  await runGit(
    config,
    buildAddCloneArgs(config, submoduleRepoRoot, submoduleWorktreeRoot),
  )
  await runGit(config, buildCheckoutArgs(submoduleWorktreeRoot, config.branch))
  await runGit(config, buildCoreWorktreeConfigArgs(submoduleWorktreeRoot))
  await runGit(
    config,
    buildSubmoduleAddArgs(config, worktreeRoot, submoduleRelPath),
  )
}

export async function cmdClone(config: CloneOpts): Promise<void> {
  config = { __proto__: null, ...config } as CloneOpts
  const { repoRoot, worktreeRoot } = await getRoots()
  if (config.verbose) {
    logger.log(`worktree root: ${worktreeRoot}`)
    logger.log(`repo root: ${repoRoot}`)
  }
  const gitmodules = await readGitmodules(config, worktreeRoot)
  const relPaths: string[] = config.paths.length
    ? config.paths.map(p => toWorktreeRelative(worktreeRoot, p))
    : [...gitmodules.byPath.keys()]
  // `git submodule init` copies a submodule's url into `.git/config` so
  // `git submodule update` can drive it — and it takes a PATHSPEC, so it errors
  // "pathspec '<path>' did not match any file(s) known to git" on a path with no
  // index entry. A fleet `upstream/<name>` reference has no gitlink by doctrine,
  // so it is exactly that case, and an unconditional init aborted the whole
  // clone. Init only the gitlink-BACKED subset; a gitlink-less reference needs
  // no init because this command clones it directly from the `.gitmodules` url.
  const gitlinks = parseStagedGitlinks(
    await readGitOutput([
      '-C',
      worktreeRoot,
      'ls-files',
      '--stage',
      '--',
      ...relPaths,
    ]),
  )
  const trackedPaths = relPaths.filter(p => gitlinks.has(p))
  if (trackedPaths.length) {
    await runGit(config, ['submodule', 'init', ...trackedPaths])
  }
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
      if (config.verbose) {
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
    if (!config.dryRun) {
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
      config,
      buildSubmoduleCloneArgs(
        submodule,
        url,
        submoduleRepoRoot,
        submoduleWorktreeRoot,
      ),
    )
    const sparsePatterns = submodule['sparse-checkout']
    if (sparsePatterns) {
      await applySparsePatterns(config, submoduleWorktreeRoot, sparsePatterns)
      logger.log(`Applied sparse-checkout patterns: ${sparsePatterns}`)
    }
    // The commit to check out: the `.gitmodules` `ref` pin, else the tracked
    // gitlink sha for a submodule that still carries one.
    const submoduleCommit = resolvePinnedCommit(
      submodule,
      gitlinks.get(submoduleRelPath),
    )
    if (!submoduleCommit) {
      logger.error(
        `Cannot resolve a pinned commit for ${submodule.name}.\n` +
          `  Where: ${path.join(worktreeRoot, '.gitmodules')}, section [submodule "${submodule.name}"]\n` +
          `  Saw:   no \`ref =\` field and no tracked 160000 gitlink at ${submoduleRelPath}\n` +
          `  Wanted: one of the two — the \`ref\` is the pin of record for a gitlink-less reference.\n` +
          `  Fix:   node scripts/fleet/gen/gitmodules-hash.mts --set ${submoduleRelPath} <ref> --label <name>-<version>`,
      )
      process.exit(1)
    }
    if (config.verbose) {
      logger.log(`${submodule.name} submodule sha1 is ${submoduleCommit}`)
    }
    let branchHeadCommit: string | undefined
    if (submodule.branch && !config.dryRun) {
      branchHeadCommit = (
        await readGitOutput([
          '-C',
          submoduleWorktreeRoot,
          'rev-parse',
          submodule.branch,
        ])
      ).trim()
      if (config.verbose) {
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
    await runGit(config, [
      '-C',
      submoduleWorktreeRoot,
      'checkout',
      ...checkoutArgs,
    ])
    await runGit(config, buildCoreWorktreeConfigArgs(submoduleWorktreeRoot))
    processed += 1
  }
  logger.log(`Cloned ${processed} submodules and skipped ${skipped}.`)
}

export async function cmdSaveSparse(config: SaveOrRestoreOpts): Promise<void> {
  config = { __proto__: null, ...config } as SaveOrRestoreOpts
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(config, worktreeRoot)
  const relPaths: string[] = config.paths.length
    ? config.paths.map(p => toWorktreeRelative(worktreeRoot, p))
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
        config,
        buildSaveSparseSetArgs(
          worktreeRoot,
          submodule.name,
          sparsePatterns.replaceAll('\n', ' '),
        ),
      )
      logger.log(`Saved sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(
        config,
        buildSaveSparseUnsetArgs(worktreeRoot, submodule.name),
        { okReturnCodes: [0, 5] },
      )
      logger.log(`Sparse checkout not enabled for ${submodule.name}.`)
    }
  }
}

export async function cmdRestoreSparse(
  config: SaveOrRestoreOpts,
): Promise<void> {
  config = { __proto__: null, ...config } as SaveOrRestoreOpts
  const { worktreeRoot } = await getRoots()
  const gitmodules = await readGitmodules(config, worktreeRoot)
  const relPaths: string[] = config.paths.length
    ? config.paths.map(p => toWorktreeRelative(worktreeRoot, p))
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
      await applySparsePatterns(config, submoduleWorktreeRoot, sparsePatterns)
      logger.log(`Applied sparse-checkout patterns for ${submodule.name}.`)
    } else {
      await runGit(
        config,
        buildSparseCheckoutDisableArgs(submoduleWorktreeRoot),
      )
      logger.log(`Sparse checkout disabled for ${submodule.name}.`)
    }
  }
}
