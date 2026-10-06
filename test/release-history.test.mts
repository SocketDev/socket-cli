import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  readReleaseCommits,
  readReleaseHistory,
} from '../scripts/release/history.mts'
import {
  deriveNextVersion,
  parseConventionalCommits,
} from '../scripts/release/version.mts'

const directories: string[] = []

function createReleaseRepository() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'release-history-'))
  directories.push(cwd)
  function git(args: readonly string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=River Morgan',
        '-c',
        'user.email=river@example.com',
        ...args,
      ],
      { cwd, encoding: 'utf8', input: '', timeout: 10_000 },
    ).trim()
  }
  git(['init', '--initial-branch=fixture-release'])
  const tree = git(['mktree'])
  function commit(subject: string, parent?: string): string {
    return git([
      'commit-tree',
      tree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      subject,
    ])
  }
  // A commit whose tree holds a package.json at `version`.
  function commitManifest(
    subject: string,
    version: string,
    parent?: string,
  ): string {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd,
      encoding: 'utf8',
      input: `{\n  "name": "fixture",\n  "version": "${version}"\n}\n`,
    }).trim()
    const manifestTree = execFileSync('git', ['mktree'], {
      cwd,
      encoding: 'utf8',
      input: `100644 blob ${blob}\tpackage.json\n`,
    }).trim()
    return git([
      'commit-tree',
      manifestTree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      subject,
    ])
  }
  return { commit, commitManifest, cwd, git }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('release history and version reservations', () => {
  it('reserves unlanded bump tags without including them in landed history', async () => {
    const repository = createReleaseRepository()
    const base = repository.commit('chore(release): 1.1.10')
    const head = repository.commit('fix(cli): retry interrupted scan', base)
    repository.git(['update-ref', 'refs/heads/fixture-release', head])
    repository.git(['tag', 'v1.1.10', base])
    for (const version of ['1.1.11', '1.1.12', '2.0.0']) {
      const bump = repository.commit(`chore(release): ${version}`, head)
      repository.git(['tag', `v${version}`, bump])
    }
    repository.git(['tag', 'v2.9.0', base])
    const history = await readReleaseHistory(
      repository.cwd,
      '1.1.11-prerelease',
    )
    expect(history).toEqual({
      anchorRef: 'v1.1.10',
      reservedVersions: ['v1.1.10', 'v1.1.11', 'v1.1.12'],
      tagVersions: ['v1.1.10'],
    })
    const commits = parseConventionalCommits(
      await readReleaseCommits(repository.cwd, history.anchorRef),
    )
    expect(commits.map(commit => commit.hash)).toEqual([head])
    expect(
      deriveNextVersion({
        commits,
        manifestVersion: '1.1.11-prerelease',
        publishedVersion: '1.1.10',
        reservedVersions: history.reservedVersions,
        tagVersions: history.tagVersions,
      }),
    ).toMatchObject({ base: '1.1.10', level: 'patch', version: '1.1.13' })
  })

  it('keeps the feature bump anchored to landed history after a burned minor', async () => {
    const repository = createReleaseRepository()
    const base = repository.commit('chore(release): 1.1.10')
    const head = repository.commit('feat(cli): add report export', base)
    repository.git(['update-ref', 'refs/heads/fixture-release', head])
    repository.git(['tag', 'v1.1.10', base])
    for (const version of ['1.2.0', '1.2.1']) {
      repository.git([
        'tag',
        `v${version}`,
        repository.commit(`chore(release): ${version}`, head),
      ])
    }
    const history = await readReleaseHistory(
      repository.cwd,
      '1.1.11-prerelease',
    )
    const commits = parseConventionalCommits(
      await readReleaseCommits(repository.cwd, history.anchorRef),
    )
    expect(
      deriveNextVersion({
        commits,
        manifestVersion: '1.1.11-prerelease',
        reservedVersions: history.reservedVersions,
        tagVersions: history.tagVersions,
      }),
    ).toMatchObject({ base: '1.1.10', level: 'minor', version: '1.2.2' })
  })

  it('anchors to the squash commit that landed a release tagged off the line', async () => {
    const repository = createReleaseRepository()
    const base = repository.commitManifest('chore(release): 1.4.1', '1.4.1')
    repository.git(['tag', 'v1.4.1', base])
    const fix = repository.commitManifest(
      'fix(cli): handle timeouts',
      '1.4.1',
      base,
    )
    const bump = repository.commitManifest(
      'chore(release): 1.4.2',
      '1.4.2',
      fix,
    )
    repository.git(['tag', 'v1.4.2', bump])
    const squash = repository.commitManifest(
      'chore(release): 1.4.2 (#12)',
      '1.4.2',
      fix,
    )
    const head = repository.commitManifest(
      'fix(cli): quote paths',
      '1.4.2',
      squash,
    )
    repository.git(['update-ref', 'refs/heads/fixture-release', head])
    const history = await readReleaseHistory(repository.cwd, '1.4.2')
    expect(history).toEqual({
      anchorRef: squash,
      reservedVersions: ['v1.4.1', 'v1.4.2'],
      tagVersions: ['v1.4.1', 'v1.4.2'],
    })
    const commits = parseConventionalCommits(
      await readReleaseCommits(repository.cwd, history.anchorRef),
    )
    expect(commits.map(commit => commit.hash)).toEqual([head])
    expect(
      deriveNextVersion({
        commits,
        manifestVersion: '1.4.2',
        publishedVersion: '1.4.2',
        reservedVersions: history.reservedVersions,
        tagVersions: history.tagVersions,
      }),
    ).toMatchObject({ base: '1.4.2', level: 'patch', version: '1.4.3' })
  })

  it('uses the complete history for an untagged release line', async () => {
    const repository = createReleaseRepository()
    const head = repository.commit('feat(cli): add initial command')
    repository.git(['update-ref', 'refs/heads/fixture-release', head])
    repository.git(['tag', 'v2.0.0', head])
    const history = await readReleaseHistory(repository.cwd, '1.0.0-prerelease')
    expect(history).toEqual({
      anchorRef: undefined,
      reservedVersions: [],
      tagVersions: [],
    })
    expect(
      parseConventionalCommits(
        await readReleaseCommits(repository.cwd, history.anchorRef),
      ).map(commit => commit.hash),
    ).toEqual([head])
  })
})
