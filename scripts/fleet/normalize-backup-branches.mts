/*
 * @file Normalizes fleet recovery refs to backup-YYYYMMDD-HHMMSS.
 *   Usage: node scripts/fleet/normalize-backup-branches.mts --repo <name> [--fix]
 *
 * Backup refs are deliberately human-readable recovery points. Git does not
 * store branch-creation time, so --fix derives the timestamp from the pointed
 * commit's author date and renders it in the fleet's America/New_York timezone.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  formatBackupBranch,
  isCanonicalBackupBranch,
} from './lib/backup-branch.mts'

export {
  BACKUP_BRANCH_RE,
  formatBackupBranch,
  isCanonicalBackupBranch,
} from './lib/backup-branch.mts'

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

export async function main(): Promise<void> {
  const repoIndex = process.argv.indexOf('--repo')
  const repo = process.argv[repoIndex + 1]
  const fix = process.argv.includes('--fix')
  if (!repo) {
    throw new Error('Missing --repo <name>.')
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

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    logger.error(errorMessage(error))
    process.exitCode = 1
  })
}
