/*
 * @file The `normalize` subcommand of `../backup-branches.mts`: rename a repo's
 *   legacy recovery refs to the canonical `backup-YYYYMMDD-HHMMSS`.
 *   Usage: node scripts/fleet/backup-branches.mts normalize --repo <name> [--fix]
 *
 * This is a MIGRATION tool, not an ongoing corrector. Every destructive fleet
 * flow now names its safety net through `formatBackupBranch`, so nothing new
 * arrives in a legacy shape. What remains is the backlog: roster repos still
 * carrying pre-canonical names from before the namer existed. Run it per repo
 * until each is clean; it stays for as long as that backlog does.
 *
 * Backup refs are deliberately human-readable recovery points. Git does not
 * store branch-creation time, so --fix derives the timestamp from the pointed
 * commit's author date and renders it in the fleet's America/New_York timezone.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { formatBackupBranch, isCanonicalBackupBranch } from './naming.mts'

const logger = getDefaultLogger()

export async function runGh(args: string[]): Promise<string> {
  const result = await spawn('gh', args, { stdioString: true })
  return String(result.stdout).trim()
}

export async function backupBranches(repo: string): Promise<string[]> {
  const output = await runGh([
    'api',
    `repos/SocketDev/${repo}/git/matching-refs/heads/backup-`,
    '--jq',
    '.[].ref',
  ])
  return output
    .split('\n')
    .filter(Boolean)
    .map(ref => ref.replace('refs/heads/', ''))
    .toSorted()
}

/**
 * Run the `normalize` subcommand over `argv` — the arguments AFTER the
 * subcommand word, so the router owns the word and this owns the flags.
 */
export async function runNormalize(argv: readonly string[]): Promise<void> {
  const repoIndex = argv.indexOf('--repo')
  const repo = repoIndex === -1 ? undefined : argv[repoIndex + 1]
  const fix = argv.includes('--fix')
  if (!repo) {
    throw new Error(
      'Missing --repo <name>. Where: scripts/fleet/backup-branches.mts ' +
        'normalize. Saw: no --repo argument. Fix: run ' +
        '`node scripts/fleet/backup-branches.mts normalize --repo <name>`.',
    )
  }
  const branches = await backupBranches(repo)
  const legacy = branches.filter(branch => !isCanonicalBackupBranch(branch))
  if (legacy.length === 0) {
    logger.success(
      `backup branches for ${repo} use the canonical timestamp format`,
    )
    return
  }
  for (let i = 0, { length } = legacy; i < length; i += 1) {
    const branch = legacy[i]!
    logger.error(`${repo}: ${branch} must use backup-YYYYMMDD-HHMMSS`)
  }
  if (!fix) {
    process.exitCode = 1
    return
  }
  for (let i = 0, { length } = legacy; i < length; i += 1) {
    const branch = legacy[i]!
    const sha = await runGh([
      'api',
      `repos/SocketDev/${repo}/git/ref/heads/${branch}`,
      '--jq',
      '.object.sha',
    ])
    const date = await runGh([
      'api',
      `repos/SocketDev/${repo}/git/commits/${sha}`,
      '--jq',
      '.committer.date',
    ])
    const target = formatBackupBranch(date)
    await runGh([
      'api',
      '--method',
      'POST',
      `repos/SocketDev/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${target}`,
      '-f',
      `sha=${sha}`,
    ])
    await runGh([
      'api',
      '--method',
      'DELETE',
      `repos/SocketDev/${repo}/git/refs/heads/${branch}`,
    ])
    logger.success(`${repo}: ${branch} → ${target}`)
  }
}
