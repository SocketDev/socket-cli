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
    rehearse: { steps: DownloadStep[] }
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
  execFileSync('python3', ['-m', 'zipfile', '-c', archive, ...names], {
    cwd: source,
  })
  const metadata = path.join(root, 'fixture.json')
  writeFileSync(
    metadata,
    JSON.stringify({
      workflow_run: { id: 123 },
      name: 'npm-release-tarballs-1',
      expired: false,
    }),
  )
  writeFileSync(
    path.join(bin, 'fake-gh.cjs'),
    `const fs = require('node:fs')
const endpoint = process.argv[3]
const id = endpoint.match(/artifacts\\/(\\d+)/)[1]
const fixture = JSON.parse(process.env.ARTIFACT_FIXTURES)[id]
process.stdout.write(fs.readFileSync(endpoint.endsWith('/zip') ? fixture.archive : fixture.metadata))
`,
  )
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(bin, 'gh.cmd'),
      '@echo off\r\nnode "%~dp0fake-gh.cjs" %*\r\n',
    )
  } else {
    writeFileSync(
      path.join(bin, 'gh'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-gh.cjs" "$@"\n',
      { mode: 0o700 },
    )
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
    ROOT_RECEIPT:
      '456:' + createHash('sha256').update(readFileSync(archive)).digest('hex'),
    DIST_DIRECTORY: destination,
    ARTIFACT_FIXTURES: JSON.stringify({ 456: { archive, metadata } }),
    GITHUB_REPOSITORY: 'fixture/release-cli',
    GITHUB_RUN_ID: '123',
    RUNNER_TEMP: root,
    VERSION: '1.2.3',
  }
  return { destination, env, metadata, archive }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const collect = (steps: DownloadStep[]) =>
  steps.find(step => step.name === 'Download verified tarballs')

describe('verified release artifact download', () => {
  it('rehearses the same checkout-free artifact collection used for staging', () => {
    expect(collect(workflow.jobs.rehearse.steps)).toEqual(
      collect(workflow.jobs.publish.steps),
    )
    expect(collect(workflow.jobs.publish.steps)?.run).toContain(
      '.github/scripts/download-release-artifacts.py',
    )
  })

  it('requires all platform receipts before collecting an RC', () => {
    const fixture = downloadFixture(['socket-2.1.0-rc.0.tgz'])
    const result = spawnSync('bash', ['-c', download], {
      env: { ...fixture.env, VERSION: '2.1.0-rc.0', NATIVE_RECEIPTS: '{}' },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Platform upload receipts')
  })

  it(
    'collects the tested launcher and all five independently uploaded platform packages',
    { timeout: 30_000 },
    () => {
      const version = '2.1.0-rc.0'
      const launcher = `socket-${version}.tgz`
      const fixture = downloadFixture([launcher])
      const artifacts = JSON.parse(fixture.env.ARTIFACT_FIXTURES)
      const receipts: Record<string, string> = {}
      const expected = [launcher]
      for (const [i, target] of [
        'darwin-arm64',
        'linux-arm64',
        'linux-x64',
        'win32-arm64',
        'win32-x64',
      ].entries()) {
        const filename = `socketsecurity-socket-cli-${target}-${version}.tgz`
        const platform = downloadFixture([filename])
        const id = String(500 + i)
        writeFileSync(
          platform.metadata,
          JSON.stringify({
            workflow_run: { id: 123 },
            name: `native-${target}-2`,
            expired: false,
          }),
        )
        artifacts[id] = {
          archive: platform.archive,
          metadata: platform.metadata,
        }
        receipts[target] = platform.env.ROOT_RECEIPT.replace(/^456:/u, `${id}:`)
        expected.push(filename)
      }
      const result = spawnSync('bash', ['-c', download], {
        env: {
          ...fixture.env,
          VERSION: version,
          ARTIFACT_FIXTURES: JSON.stringify(artifacts),
          NATIVE_RECEIPTS: JSON.stringify(receipts),
        },
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readdirSync(fixture.destination).sort()).toEqual(expected.sort())
    },
  )

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
    fixture.env.ROOT_RECEIPT = '456:' + '0'.repeat(64)
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
