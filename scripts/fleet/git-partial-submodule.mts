#!/usr/bin/env node

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

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { checkGitVersion, logger } from './git-partial-submodule-internal.mts'
import type { CommonOpts } from './git-partial-submodule-internal.mts'
import type { AddOpts } from './git-partial-submodule-internal.mts'
import {
  cmdAdd,
  cmdClone,
  cmdRestoreSparse,
  cmdSaveSparse,
} from './git-partial-submodule-commands.mts'
import { isMainModule } from './_shared/is-main-module.mts'

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

export function parseArgs(argv: string[]): {
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

export function parseAddArgs(common: CommonOpts, rest: string[]): AddOpts {
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

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    const msg = errorMessage(err)
    logger.error(`git-partial-submodule: ${msg}`)
    process.exitCode = 1
  })
}
