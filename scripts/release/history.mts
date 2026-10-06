import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

import {
  COMMIT_LOG_FORMAT,
  maxReleaseVersion,
  releaseVersionsForLine,
} from './version.mts'

const execFile = promisify(execFileCallback)

export interface ReleaseHistory {
  // Where the changelog range starts: the newest landed release's tag, or the
  // commit that landed it when the tag sits off the release line.
  readonly anchorRef: string | undefined
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

/**
 * Map each tagged version that is not reachable from HEAD to the first-parent
 * commit that set package.json to it. A squash merge lands a release bump
 * under a new SHA, which leaves the tag on a commit outside the release line.
 */
async function findSquashLandedReleases(
  cwd: string,
  unreachableTags: readonly string[],
): Promise<Map<string, string>> {
  const landed = new Map<string, string>()
  const wanted = new Map(
    unreachableTags.map(tag => [tag.replace(/^v/, ''), tag]),
  )
  if (!wanted.size) {
    return landed
  }
  const shas = (
    await readReleaseGit(cwd, [
      'log',
      '--first-parent',
      '--format=%H',
      '-G',
      '"version":',
      'HEAD',
      '--',
      'package.json',
    ])
  )
    .split('\n')
    .filter(Boolean)
  for (const sha of shas) {
    // eslint-disable-next-line no-await-in-loop
    const manifest = await readReleaseGit(cwd, ['show', `${sha}:package.json`])
    const version = (JSON.parse(manifest) as { version?: string }).version
    const tag = version ? wanted.get(version) : undefined
    if (tag && !landed.has(tag)) {
      landed.set(tag, sha)
      if (landed.size === wanted.size) {
        break
      }
    }
  }
  return landed
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
  const reachableTags = releaseVersionsForLine(
    landedTags.trim().split('\n'),
    manifestVersion,
  )
  const squashLanded = await findSquashLandedReleases(
    cwd,
    reservedVersions.filter(tag => !reachableTags.includes(tag)),
  )
  const tagVersions = [...reachableTags, ...squashLanded.keys()]
  const anchorVersion = maxReleaseVersion(tagVersions)
  const anchorTag = anchorVersion ? `v${anchorVersion}` : undefined
  return {
    anchorRef: anchorTag
      ? (squashLanded.get(anchorTag) ?? anchorTag)
      : undefined,
    reservedVersions,
    tagVersions,
  }
}

export async function readReleaseCommits(
  cwd: string,
  anchorRef: string | undefined,
): Promise<string> {
  const range = anchorRef ? `${anchorRef}..HEAD` : 'HEAD'
  return await readReleaseGit(cwd, [
    'log',
    range,
    `--format=${COMMIT_LOG_FORMAT}`,
  ])
}
