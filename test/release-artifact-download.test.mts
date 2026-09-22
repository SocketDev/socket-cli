import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface DownloadStep {
  name?: string
  run?: string
}
const workflow = parse(
  readFileSync(
    new URL('../.github/workflows/publish-npm.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: {
    verify: { steps: DownloadStep[] }
    publish: { steps: DownloadStep[] }
  }
}
const download = workflow.jobs.verify.steps.find(
  step => step.name === 'Verify artifact transfer',
)!.run!
const directories: string[] = []
const filenames = [
  'socket-1.2.3.tgz',
  'socketsecurity-cli-1.2.3.tgz',
  'socketsecurity-cli-with-sentry-1.2.3.tgz',
]

function downloadFixture(names = filenames) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'release-download-'))
  directories.push(root)
  const source = path.join(root, 'source')
  const bin = path.join(root, 'bin')
  const destination = path.join(root, 'dist')
  mkdirSync(source)
  mkdirSync(bin)
  for (const name of names) {
    writeFileSync(path.join(source, name), 'verified package bytes')
  }
  const archive = path.join(root, 'fixture.zip')
  execFileSync('zip', ['-q', '-0', archive, ...names], { cwd: source })
  const metadata = path.join(root, 'fixture.json')
  writeFileSync(
    metadata,
    JSON.stringify({
      workflow_run: { id: 123 },
      name: 'npm-release-tarballs',
      expired: false,
    }),
  )
  writeFileSync(
    path.join(bin, 'gh'),
    '#!/bin/sh\ncase "$2" in */zip) cat "$FIXTURE_ARCHIVE";; *) cat "$FIXTURE_METADATA";; esac\n',
    { mode: 0o700 },
  )
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
    ARTIFACT_ID: '456',
    ARTIFACT_DIGEST: createHash('sha256')
      .update(readFileSync(archive))
      .digest('hex'),
    DIST_DIRECTORY: destination,
    FIXTURE_ARCHIVE: archive,
    FIXTURE_METADATA: metadata,
    GITHUB_REPOSITORY: 'fixture/release-cli',
    GITHUB_RUN_ID: '123',
    RUNNER_TEMP: root,
    VERSION: '1.2.3',
  }
  return { destination, env, metadata }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('verified release artifact download', () => {
  it('uses the same download implementation in verification and publishing', () => {
    expect(
      workflow.jobs.publish.steps.find(
        step => step.name === 'Download verified tarballs',
      )?.run,
    ).toBe(download)
  })

  it('downloads and extracts the three verified tarballs', () => {
    const fixture = downloadFixture()
    const result = spawnSync('bash', ['-c', download], {
      env: fixture.env,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readdirSync(fixture.destination).sort()).toEqual(
      [...filenames].sort(),
    )
    expect(
      readFileSync(path.join(fixture.destination, filenames[0]!), 'utf8'),
    ).toBe('verified package bytes')
  })

  it('refuses altered archive bytes', () => {
    const fixture = downloadFixture()
    fixture.env.ARTIFACT_DIGEST = '0'.repeat(64)
    expect(
      spawnSync('bash', ['-c', download], { env: fixture.env }).status,
    ).not.toBe(0)
  })

  it('refuses artifacts from another workflow run', () => {
    const fixture = downloadFixture()
    fixture.env.GITHUB_RUN_ID = '999'
    expect(
      spawnSync('bash', ['-c', download], { env: fixture.env }).status,
    ).not.toBe(0)
  })

  it('refuses unexpected archive entries', () => {
    const fixture = downloadFixture([...filenames, 'unexpected.txt'])
    expect(
      spawnSync('bash', ['-c', download], { env: fixture.env }).status,
    ).not.toBe(0)
  })
})
