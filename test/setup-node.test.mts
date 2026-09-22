import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  installNodeForCi,
  nodeSetupAsset,
  nodeSetupDigest,
  parseNodeSetupVersion,
  resolveNodeSetupVersion,
  runNodeSetup,
} from '../scripts/ci/setup-node.mjs'

const directories: string[] = []

async function installationFixture(arch = 'x64') {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), 'setup-node-test-'))
  directories.push(runnerTemp)
  const githubPath = path.join(runnerTemp, 'github-path')
  await writeFile(githubPath, '')
  const bytes = Buffer.from('fixture Node.js archive bytes')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const archiveRoot = `node-v24.12.0-linux-${arch}`
  const asset = `${archiveRoot}.tar.gz`
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).endsWith('/index.json')) {
      return Response.json([
        { version: 'v24.9.0' },
        { version: 'v24.12.0' },
        { version: 'v25.0.0' },
      ])
    }
    if (String(url).endsWith('/SHASUMS256.txt')) {
      return new Response(`${digest}  ${asset}\n`)
    }
    return new Response(bytes)
  })
  const extract = vi.fn(async (archive: string, destination: string) => {
    expect(await readFile(archive)).toEqual(bytes)
    const bin = path.join(destination, archiveRoot, 'bin')
    await mkdir(bin, { recursive: true })
    const executable = path.join(bin, 'node')
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
  })
  return {
    asset,
    dependencies: { extract, fetcher },
    options: {
      arch,
      githubPath,
      platform: 'linux',
      runnerTemp,
      version: '24.12.0',
    },
  }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  )
})

describe('Node.js release selection', () => {
  it('accepts an exact version without consulting an index', () => {
    expect(parseNodeSetupVersion('v24.12.0')).toEqual({
      kind: 'exact',
      version: '24.12.0',
    })
    expect(resolveNodeSetupVersion('24.12.0', [])).toBe('24.12.0')
  })

  it.each(['24', '24.x', 'v24'])(
    'resolves %s numerically and excludes prereleases',
    wanted => {
      expect(
        resolveNodeSetupVersion(wanted, [
          'v24.9.9',
          'v24.12.1',
          'v25.0.0',
          'v24.12.0',
          'v24.99.0-rc.1',
          'invalid',
        ]),
      ).toBe('24.12.1')
    },
  )

  it.each(['', 'latest', 'lts/*', '24.12', '../24', '24.12.0-rc.1', '024'])(
    'rejects unsupported version input: %s',
    wanted => {
      expect(() => parseNodeSetupVersion(wanted)).toThrow()
    },
  )

  it('refuses a major missing from the release index', () => {
    expect(() => resolveNodeSetupVersion('24', ['v22.0.0'])).toThrow()
  })

  it.each(['x64', 'arm64'])('selects the Linux %s release asset', arch => {
    expect(nodeSetupAsset('24.12.0', 'linux', arch)).toEqual({
      archiveRoot: `node-v24.12.0-linux-${arch}`,
      asset: `node-v24.12.0-linux-${arch}.tar.gz`,
    })
  })

  it('requires one exact checksum entry', () => {
    const digest = '0123456789abcdef'.repeat(4)
    const asset = 'node-v24.12.0-linux-x64.tar.gz'
    expect(nodeSetupDigest(`${digest}  ${asset}\n`, asset)).toBe(digest)
    expect(() =>
      nodeSetupDigest(`${digest}  ${asset}.other\n`, asset),
    ).toThrow()
    expect(() =>
      nodeSetupDigest(`${digest}  ${asset}\n${digest}  ${asset}\n`, asset),
    ).toThrow()
  })
})

describe('verified Node.js installation', () => {
  it.each(['x64', 'arm64'])(
    'installs verified %s bytes before exporting PATH',
    async arch => {
      const fixture = await installationFixture(arch)
      const result = await installNodeForCi(
        fixture.options,
        fixture.dependencies,
      )
      expect(result.version).toBe('24.12.0')
      expect(result.bin.startsWith(fixture.options.runnerTemp + path.sep)).toBe(
        true,
      )
      expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
        `${result.bin}\n`,
      )
      expect(
        fixture.dependencies.fetcher.mock.calls.map(([url]) => url),
      ).toEqual([
        'https://nodejs.org/dist/v24.12.0/SHASUMS256.txt',
        `https://nodejs.org/dist/v24.12.0/${fixture.asset}`,
      ])
      expect(fixture.dependencies.extract).toHaveBeenCalledTimes(1)
      const installation = fixture.dependencies.extract.mock.calls[0]![1]
      expect(await readdir(installation)).toEqual([
        `node-v24.12.0-linux-${arch}`,
      ])
    },
  )

  it('resolves a requested major before downloading its archive', async () => {
    const fixture = await installationFixture()
    const result = await installNodeForCi(
      { ...fixture.options, version: '24' },
      fixture.dependencies,
    )
    expect(result.version).toBe('24.12.0')
    expect(fixture.dependencies.fetcher.mock.calls[0]![0]).toBe(
      'https://nodejs.org/dist/index.json',
    )
  })

  it('rejects altered archive bytes before extraction or PATH changes', async () => {
    const fixture = await installationFixture()
    fixture.dependencies.fetcher.mockResolvedValueOnce(
      new Response(`${'0'.repeat(64)}  ${fixture.asset}\n`),
    )
    await expect(
      installNodeForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe('')
    expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
  })

  it('cleans a failed extraction without adding PATH', async () => {
    const fixture = await installationFixture()
    fixture.dependencies.extract.mockRejectedValueOnce(
      new Error('fixture extraction failure'),
    )
    await expect(
      installNodeForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'INSTALL_FAILED' })
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe('')
    expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
  })

  it('refuses an archive without an executable node', async () => {
    const fixture = await installationFixture()
    fixture.dependencies.extract.mockResolvedValueOnce(undefined)
    await expect(
      installNodeForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'INSTALL_FAILED' })
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe('')
  })

  it.each([403, 404, 503])('fails closed on download HTTP %i', async status => {
    const fixture = await installationFixture()
    fixture.dependencies.fetcher.mockResolvedValueOnce(
      new Response('', { status }),
    )
    await expect(
      installNodeForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
  })

  it('refuses a malformed release index', async () => {
    const fixture = await installationFixture()
    fixture.dependencies.fetcher.mockResolvedValueOnce(
      Response.json({ versions: [] }),
    )
    await expect(
      installNodeForCi(
        { ...fixture.options, version: '24' },
        fixture.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RELEASE_INDEX' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
  })

  it('rejects an unsupported runner before downloading', async () => {
    const fixture = await installationFixture()
    await expect(
      installNodeForCi(
        { ...fixture.options, platform: 'darwin' },
        fixture.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' })
    expect(fixture.dependencies.fetcher).not.toHaveBeenCalled()
  })
})

describe('Node.js setup entrypoint', () => {
  it('describes its behavior without starting installation', async () => {
    const install = vi.fn()
    const stdout = vi.fn()
    expect(
      await runNodeSetup(['--describe', '--json'], { install, stdout }),
    ).toBe(0)
    expect(JSON.parse(stdout.mock.calls[0]![0])).toHaveProperty('description')
    expect(install).not.toHaveBeenCalled()
  })

  it('passes runner paths and the version to installation and emits JSON', async () => {
    const install = vi.fn(async () => ({
      bin: '/tmp/fixture/bin',
      version: '24.12.0',
    }))
    const stdout = vi.fn()
    expect(
      await runNodeSetup(['--version', '24', '--json'], {
        env: { GITHUB_PATH: '/tmp/fixture-path', RUNNER_TEMP: '/tmp/fixture' },
        install,
        stdout,
      }),
    ).toBe(0)
    expect(install).toHaveBeenCalledExactlyOnceWith({
      githubPath: '/tmp/fixture-path',
      runnerTemp: '/tmp/fixture',
      version: '24',
    })
    expect(JSON.parse(stdout.mock.calls[0]![0])).toEqual({
      bin: '/tmp/fixture/bin',
      version: '24.12.0',
    })
  })

  it('returns failure with a structured error for unsupported arguments', async () => {
    const install = vi.fn()
    const stderr = vi.fn()
    expect(
      await runNodeSetup(['--version', '24', '--unknown', '--json'], {
        install,
        stderr,
      }),
    ).toBe(1)
    expect(JSON.parse(stderr.mock.calls[0]![0])).toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    expect(install).not.toHaveBeenCalled()
  })
})
