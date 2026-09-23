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
import { parse } from 'yaml'

import { installUvForCi, uvSetupRelease } from '../scripts/ci/setup-uv.mts'

const directories: string[] = []

async function uvFixture(arch = 'x64') {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), 'setup-uv-test-'))
  directories.push(runnerTemp)
  const githubPath = path.join(runnerTemp, 'github-path')
  await writeFile(githubPath, 'existing-bin\n')
  const bytes = Buffer.from('fixture uv archive bytes')
  const release = {
    ...uvSetupRelease('linux', arch),
    digest: createHash('sha512').update(bytes).digest('base64'),
  }
  const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes))
  const extract = vi.fn(async (archive: string, destination: string) => {
    expect(await readFile(archive)).toEqual(bytes)
    expect(await readFile(githubPath, 'utf8')).toBe('existing-bin\n')
    const bin = path.join(destination, release.archiveRoot)
    await mkdir(bin, { recursive: true })
    const executable = path.join(bin, 'uv')
    await writeFile(executable, '#!/bin/sh\nprintf "uv 0.12.15\\n"\n')
    await chmod(executable, 0o755)
  })
  const probe = vi.fn(async () => {
    expect(await readFile(githubPath, 'utf8')).toBe('existing-bin\n')
    return 'uv 0.12.15 (fixture)'
  })
  return {
    dependencies: { extract, fetcher, probe, release },
    options: { arch, githubPath, platform: 'linux', runnerTemp },
    release,
  }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  )
})

describe('verified uv installation', () => {
  it.each([
    ['x64', 'x86_64'],
    ['arm64', 'aarch64'],
  ])(
    'installs verified %s bytes before exporting PATH',
    async (arch, target) => {
      const fixture = await uvFixture(arch)
      const result = await installUvForCi(fixture.options, fixture.dependencies)
      const installation = fixture.dependencies.extract.mock.calls[0]![1]
      expect(result).toEqual({
        bin: path.join(installation, 'uv-' + target + '-unknown-linux-gnu'),
        version: '0.12.15',
      })
      expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
        'existing-bin\n' + result.bin + '\n',
      )
      expect(fixture.dependencies.fetcher).toHaveBeenCalledExactlyOnceWith(
        'https://github.com/astral-sh/uv/releases/download/0.12.15/uv-' +
          target +
          '-unknown-linux-gnu.tar.gz',
        { redirect: 'follow', signal: expect.any(AbortSignal) },
      )
      expect(fixture.dependencies.extract).toHaveBeenCalledTimes(1)
      expect(fixture.dependencies.probe).toHaveBeenCalledExactlyOnceWith(
        path.join(result.bin, 'uv'),
      )
      expect(await readdir(installation)).toEqual([fixture.release.archiveRoot])
    },
  )

  it('rejects altered bytes before extraction or PATH changes', async () => {
    const fixture = await uvFixture()
    fixture.dependencies.fetcher.mockResolvedValueOnce(new Response('altered'))
    await expect(
      installUvForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n',
    )
    expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
  })

  it.each([403, 404, 503])('fails closed on HTTP %i', async status => {
    const fixture = await uvFixture()
    fixture.dependencies.fetcher.mockResolvedValueOnce(
      new Response('', { status }),
    )
    await expect(
      installUvForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n',
    )
    expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
  })

  it('fails closed on a network rejection', async () => {
    const fixture = await uvFixture()
    fixture.dependencies.fetcher.mockRejectedValueOnce(new TypeError('offline'))
    await expect(
      installUvForCi(fixture.options, fixture.dependencies),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n',
    )
    expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
  })

  it.each([
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['linux', 'ia32'],
  ])('rejects %s %s before downloading', async (platform, arch) => {
    const fixture = await uvFixture()
    await expect(
      installUvForCi(
        { ...fixture.options, arch, platform },
        fixture.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' })
    expect(fixture.dependencies.fetcher).not.toHaveBeenCalled()
    expect(fixture.dependencies.extract).not.toHaveBeenCalled()
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n',
    )
  })

  it.each(['RUNNER_TEMP', 'GITHUB_PATH'])(
    'rejects a missing %s before downloading',
    async name => {
      const fixture = await uvFixture()
      const options = { ...fixture.options }
      const key = name === 'RUNNER_TEMP' ? 'runnerTemp' : 'githubPath'
      options[key] = ''
      await expect(
        installUvForCi(options, fixture.dependencies),
      ).rejects.toMatchObject({ code: 'INVALID_RUNNER_PATH' })
      expect(fixture.dependencies.fetcher).not.toHaveBeenCalled()
    },
  )

  it.each(['failure', 'missing', 'nonexecutable'])(
    'cleans an extraction with %s uv without exporting PATH',
    async condition => {
      const fixture = await uvFixture()
      fixture.dependencies.extract.mockImplementationOnce(
        async (archive, destination) => {
          if (condition === 'failure') {
            throw new Error('fixture extraction failure')
          }
          if (condition === 'nonexecutable') {
            const bin = path.join(destination, fixture.release.archiveRoot)
            await mkdir(bin, { recursive: true })
            await writeFile(path.join(bin, 'uv'), await readFile(archive), {
              mode: 0o600,
            })
          }
        },
      )
      await expect(
        installUvForCi(fixture.options, fixture.dependencies),
      ).rejects.toMatchObject({ code: 'INSTALL_FAILED' })
      expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
        'existing-bin\n',
      )
      expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
    },
  )

  it.each(['uv 0.12.14', 'python 0.12.15', ''])(
    'rejects version output %j before exporting PATH',
    async output => {
      const fixture = await uvFixture()
      fixture.dependencies.probe.mockResolvedValueOnce(output)
      await expect(
        installUvForCi(fixture.options, fixture.dependencies),
      ).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
      expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
        'existing-bin\n',
      )
      expect(await readdir(fixture.options.runnerTemp)).toEqual(['github-path'])
    },
  )

  it('runs the installed executable to confirm its version', async () => {
    const fixture = await uvFixture()
    const result = await installUvForCi(fixture.options, {
      extract: fixture.dependencies.extract,
      fetcher: fixture.dependencies.fetcher,
      release: fixture.release,
    })
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n' + result.bin + '\n',
    )
  })

  it('downloads again when an installation already exists', async () => {
    const fixture = await uvFixture()
    const first = await installUvForCi(fixture.options, fixture.dependencies)
    fixture.dependencies.extract.mockImplementationOnce(
      async (archive, destination) => {
        const bin = path.join(destination, fixture.release.archiveRoot)
        await mkdir(bin, { recursive: true })
        await writeFile(path.join(bin, 'uv'), await readFile(archive), {
          mode: 0o755,
        })
      },
    )
    fixture.dependencies.probe.mockResolvedValueOnce('uv 0.12.15')
    const second = await installUvForCi(fixture.options, fixture.dependencies)
    expect(second.bin).not.toBe(first.bin)
    expect(fixture.dependencies.fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(fixture.options.githubPath, 'utf8')).toBe(
      'existing-bin\n' + first.bin + '\n' + second.bin + '\n',
    )
  })
})

it('installs uv after Node and before SFW shims through its registered script', async () => {
  const workflow = parse(
    await readFile(
      new URL('../.github/workflows/e2e-tests.yml', import.meta.url),
      'utf8',
    ),
  ) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>
  }
  const steps = workflow.jobs['e2e-tests']!.steps
  const node = steps.findIndex(step => step.name === 'Install Node.js')
  const uv = steps.findIndex(step => step.name === 'Install uv')
  const shims = steps.findIndex(step => step.name === 'Create sfw shims')
  expect(node).toBeGreaterThanOrEqual(0)
  expect(uv).toBeGreaterThan(node)
  expect(shims).toBeGreaterThan(uv)
  expect(steps[uv]?.run).toBe('pnpm run ci:setup-uv')
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> }
  expect(manifest.scripts['ci:setup-uv']).toBe('node scripts/ci/setup-uv.mts')
})
