#!/usr/bin/env node
/*
 * @file The one entrypoint for the fleet's backup branches — the
 *   `backup-YYYYMMDD-HHMMSS` safety nets a destructive flow parks before it
 *   rewrites history. Everything that reads, renames, or retires them lives in
 *   `backup-branches/`, and this file is the only way to run any of it.
 *
 *   Subcommands:
 *
 *   - `prune`     — retire spent safety nets, gated on retention AND a
 *                   unique-content veto. See `backup-branches/prune.mts`.
 *   - `normalize` — rename a repo's legacy recovery refs to the canonical
 *                   timestamp form. See `backup-branches/normalize.mts`.
 *
 *   Usage: node scripts/fleet/backup-branches.mts <prune|normalize> [flags]
 *
 *   Naming itself is `backup-branches/naming.mts`, imported directly by the
 *   flows that CREATE a backup (squash, reorder, consolidate) and by the
 *   release scan that looks for parked work. Those are library calls, not CLI
 *   runs, so they bypass this router by design.
 */

import process from 'node:process'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { runNormalize } from './backup-branches/normalize.mts'
import { runPrune } from './backup-branches/prune.mts'

/**
 * The subcommands this router accepts, in help-text order.
 */
export const BACKUP_BRANCH_SUBCOMMANDS = ['prune', 'normalize'] as const

export type BackupBranchSubcommand = (typeof BACKUP_BRANCH_SUBCOMMANDS)[number]

/**
 * True when `word` names a subcommand this router can dispatch.
 */
export function isBackupBranchSubcommand(
  word: string,
): word is BackupBranchSubcommand {
  return (BACKUP_BRANCH_SUBCOMMANDS as readonly string[]).includes(word)
}

/**
 * The What / Where / Saw vs. wanted / Fix message for an argv this router
 * cannot dispatch. `saw` is undefined when no subcommand was supplied at all,
 * which reads differently from a typo and so gets its own wording.
 */
export function subcommandErrorMessage(saw: string | undefined): string {
  const wanted = BACKUP_BRANCH_SUBCOMMANDS.join(' | ')
  const what =
    saw === undefined
      ? 'Missing subcommand for the backup-branch tool.'
      : `Unknown backup-branch subcommand: ${saw}.`
  return (
    `${what} Where: scripts/fleet/backup-branches.mts. ` +
    `Saw: ${saw === undefined ? 'no subcommand' : saw}, wanted one of ` +
    `${wanted}. Fix: run \`node scripts/fleet/backup-branches.mts ` +
    `<${wanted}> [flags]\`.`
  )
}

/**
 * Dispatch one subcommand. `argv` is the full argument list AFTER the script
 * path, so `argv[0]` is the subcommand word and the rest are its flags.
 */
export async function runBackupBranches(
  argv: readonly string[],
): Promise<void> {
  const word = argv[0]
  if (word === undefined || !isBackupBranchSubcommand(word)) {
    throw new Error(subcommandErrorMessage(word))
  }
  const rest = argv.slice(1)
  if (word === 'prune') {
    await runPrune(rest)
    return
  }
  await runNormalize(rest)
}

export async function main(): Promise<void> {
  await runBackupBranches(process.argv.slice(2))
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'manage the fleet backup-YYYYMMDD-HHMMSS safety-net branches: prune spent ones, normalize legacy names',
  help: `Usage: node scripts/fleet/backup-branches.mts <prune|normalize> [flags]

Commands:
  prune      retire spent safety nets, gated on retention AND a unique-content veto
             --all | --repo <name> | --days <n> | --keep <n> | --local | --allow-pre-root | --dry-run
  normalize  rename a repo's legacy recovery refs to the canonical timestamp form
             --repo <name> (required) | --fix`,
}

if (isMainModule(import.meta.url)) {
  // runMain, not a bare async IIFE: a rejection here would otherwise surface as
  // a raw unhandled-rejection stack instead of a logged message + exit code.
  runMain(main, SCRIPT_META)
}
