import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseVersion } from '@socketsecurity/lib-stable/versions/parse'

import { replaceVersion } from '../fleet/bump/manifest-write.mts'
import {
  COMMIT_LOG_FORMAT,
  parseChangelogCommits,
} from '../fleet/changelog/commits.mts'
import { composeChangelogSectionFromCommits } from '../fleet/changelog/compose.mts'
import { insertChangelogVersionSection } from '../fleet/changelog/sections.mts'
import { PACKAGE_JSON, REPO_ROOT } from '../fleet/paths.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import { runCapture } from '../fleet/registry-infra/shared.mts'
import { checkCliReleaseVersion } from './check/cli-package-is-single.mts'

const logger = getDefaultLogger()
const changelogPath = path.join(REPO_ROOT, 'CHANGELOG.md')

export function cliPrereleaseVersion(
  version: string,
  sha: string,
  timestamp: string,
): string {
  const parsed = parseVersion(version)
  const date = new Date(timestamp)
  if (
    parsed?.major !== 2 ||
    !parsed.prerelease.length ||
    !/^[0-9a-f]{40}$/.test(sha) ||
    !Number.isFinite(date.getTime())
  ) {
    throw new Error(
      'Invalid release source. Where: Socket CLI bump. Saw invalid version, SHA, or timestamp; wanted a 2.x prerelease and Git source identity. Fix: use a committed prerelease source.',
    )
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-prerelease.${date.toISOString().slice(0, 10).replaceAll('-', '')}-${sha.slice(0, 7)}`
}

async function gitOutput(args: string[]): Promise<string> {
  const result = await runCapture('git', args, REPO_ROOT)
  if (result.code !== 0) {
    throw new Error(
      `Git source lookup failed. Where: Socket CLI release. Saw exit ${result.code}; wanted committed source metadata. Fix: fetch the release history.`,
    )
  }
  return result.stdout.trim()
}

export async function cliReleaseSource(
  version: string,
): Promise<{ date: string; sha: string; version: string }> {
  const subject = await gitOutput(['log', '-1', '--format=%s'])
  const revision =
    subject === `chore: bump version to ${version}` ? 'HEAD^' : 'HEAD'
  const sha = await gitOutput(['rev-parse', revision])
  const timestamp = await gitOutput(['show', '-s', '--format=%cI', revision])
  const date = new Date(timestamp).toISOString().slice(0, 10)
  return { date, sha, version: cliPrereleaseVersion(version, sha, timestamp) }
}

export async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      'write-only': { type: 'boolean' },
      'release-as': { type: 'string' },
    },
  })
  if (values['release-as'] || (!values['dry-run'] && !values['write-only'])) {
    throw new Error(
      'Unsupported release invocation. Where: Socket CLI bump. Wanted --dry-run or pipeline --write-only with the committed version core. Fix: use the npm publish pipeline.',
    )
  }
  const original = readFileSync(PACKAGE_JSON, 'utf8')
  const manifest = JSON.parse(original) as { version: string }
  const source = await cliReleaseSource(manifest.version)
  const findings = checkCliReleaseVersion({
    date: source.date.replaceAll('-', ''),
    sha: source.sha,
    version: source.version,
    distTag: getEnvValue('DIST_TAG') ?? 'prerelease',
  })
  if (findings.length) {
    throw new Error(findings.join('\n'))
  }
  logger.info(`Socket CLI prerelease: ${source.version}`)
  if (values['dry-run'] || manifest.version === source.version) {
    return
  }
  const previous = await runCapture(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v2.*', source.sha],
    REPO_ROOT,
  )
  const range =
    previous.code === 0
      ? `${previous.stdout.trim()}..${source.sha}`
      : source.sha
  const commits = parseChangelogCommits(
    await gitOutput(['log', `--format=${COMMIT_LOG_FORMAT}`, range]),
  )
  const section = composeChangelogSectionFromCommits({
    commits,
    date: source.date,
    repoUrl: 'https://github.com/SocketDev/socket-cli',
    version: source.version,
  })
  const changelog = insertChangelogVersionSection(
    readFileSync(changelogPath, 'utf8'),
    section,
  )
  writeFileSync(changelogPath, changelog)
  writeFileSync(PACKAGE_JSON, replaceVersion(original, source.version))
}

const SCRIPT_META = {
  describe: 'generates a source-bound Socket CLI prerelease',
  help: 'Usage: pnpm run bump --dry-run | --write-only',
  json: 'result' as const,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
