import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

import {
  COMMIT_LOG_FORMAT,
  maxReleaseVersion,
  releaseVersionsForLine,
} from './version.mts'

const execFile = promisify(execFileCallback)

export interface ReleaseHistory {
  readonly anchorTag: string | undefined
  readonly reservedVersions: readonly string[]
  readonly tagVersions: readonly string[]
}

async function readReleaseGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFile('git', [...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  })
  return stdout
}

export async function readReleaseHistory(
  cwd: string,
  manifestVersion: string,
): Promise<ReleaseHistory> {
  const [allTags, landedTags] = await Promise.all([
    readReleaseGit(cwd, ['tag', '--list', 'v*']),
    readReleaseGit(cwd, ['tag', '--merged', 'HEAD', '--list', 'v*']),
  ])
  const reservedVersions = releaseVersionsForLine(
    allTags.trim().split('\n'),
    manifestVersion,
  )
  const tagVersions = releaseVersionsForLine(
    landedTags.trim().split('\n'),
    manifestVersion,
  )
  const anchorVersion = maxReleaseVersion(tagVersions)
  return {
    anchorTag: anchorVersion ? `v${anchorVersion}` : undefined,
    reservedVersions,
    tagVersions,
  }
}

export async function readReleaseCommits(
  cwd: string,
  anchorTag: string | undefined,
): Promise<string> {
  const range = anchorTag ? `${anchorTag}..HEAD` : 'HEAD'
  return await readReleaseGit(cwd, [
    'log',
    range,
    `--format=${COMMIT_LOG_FORMAT}`,
  ])
}
