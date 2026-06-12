/**
 * Emit the codifying-disciplines Phase-2 enforcement-surface inventory as a
 * JSON envelope — the ground truth the scan agents compare proposals against,
 * so the skill stops re-describing `ls`/`grep` recipes by hand and every agent
 * works from one authoritative set.
 *
 * Thin wrapper: it calls the EXISTING collectors in lib/enforcer-inventory.mts
 * (the same owner the claude-md-rules-are-enforced gate uses) rather than
 * re-deriving the directory conventions. The only logic it adds is splitting
 * the flat hook set into guards / reminders / installers by name suffix, since
 * the scan's overlap check keys on that distinction.
 *
 * Usage:
 *   node scripts/fleet/codify-scan/inventory.mts [--repo-root <path>]
 */

import path from 'node:path'
import process from 'node:process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  collectFleetDocs,
  collectHookEnforcers,
  collectLintRules,
  collectScriptPaths,
} from '../lib/enforcer-inventory.mts'
import { REPO_ROOT } from '../paths.mts'

export interface EnforcementInventory {
  hooks: {
    guards: string[]
    reminders: string[]
    installers: string[]
  }
  lintRules: {
    socket: string[]
    typescript: string[]
  }
  checks: string[]
  scripts: string[]
  fleetDocs: string[]
}

// Split the flat hook-enforcer set by the fleet naming convention: a `-guard`
// BLOCKS, a `-reminder` NUDGES, anything else (an installer hook with an
// install.mts, e.g. setup-signing) is an installer. The split is what the
// scan's overlap check ("does a guard/reminder for this already exist?") reads.
export function splitHooks(names: Iterable<string>): {
  guards: string[]
  reminders: string[]
  installers: string[]
} {
  const guards: string[] = []
  const reminders: string[] = []
  const installers: string[] = []
  for (const name of names) {
    if (name.endsWith('-guard')) {
      guards.push(name)
    } else if (name.endsWith('-reminder')) {
      reminders.push(name)
    } else {
      installers.push(name)
    }
  }
  guards.sort()
  reminders.sort()
  installers.sort()
  return { guards, installers, reminders }
}

export function buildInventory(repoRoot: string): EnforcementInventory {
  const hooks = splitHooks(collectHookEnforcers(repoRoot))
  const lint = collectLintRules(repoRoot)
  // Check scripts are the scripts under scripts/fleet/check/; collectScriptPaths
  // returns all script paths, so the check arm is the subset under check/.
  const allScripts = [...collectScriptPaths(repoRoot)].toSorted()
  const checks = allScripts
    .filter(p => p.includes('/check/') || p.startsWith('check/'))
    .toSorted()
  return {
    checks,
    fleetDocs: collectFleetDocs(repoRoot).toSorted(),
    hooks,
    lintRules: {
      socket: [...lint.socketRules].toSorted(),
      typescript: [...lint.tsRules].toSorted(),
    },
    scripts: allScripts,
  }
}

export function main(): void {
  const argv = process.argv.slice(2)
  const idx = argv.indexOf('--repo-root')
  const repoRoot = idx !== -1 ? path.resolve(argv[idx + 1]!) : REPO_ROOT
  if (!existsSync(repoRoot)) {
    process.stderr.write(`repo root not found: ${repoRoot}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `${JSON.stringify(buildInventory(repoRoot), undefined, 2)}\n`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
