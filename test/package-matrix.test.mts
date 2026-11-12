import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  createPrivatePnpmEnvironment,
  currentPrereleaseVersion,
  makeVariants,
  readPackagedManifest,
  run,
  updateRootManifest,
  validatePackagedManifest,
  validatePrivateVirtualStore,
  verifyPrivateVirtualStore,
} from '../scripts/build-package-matrix.mts'

function tarEntry(name: string, contents: string): Buffer {
  const data = Buffer.from(contents)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write('0000644\0', 100, 8)
  header.write('0000000\0', 108, 8)
  header.write('0000000\0', 116, 8)
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12)
  header.write('00000000000\0', 136, 12)
  header.fill(32, 148, 156)
  header.write('0', 156, 1)
  header.write('ustar\0', 257, 6)
  header.write('00', 263, 2)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512)
  data.copy(padded)
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]))
}

describe('package matrix helpers', () => {
  it('accepts only the SEA prerelease version format', () => {
    expect(currentPrereleaseVersion('2.1.0-rc.17')).toBe(
      '2.1.0-rc.17',
    )
    expect(() => currentPrereleaseVersion('2.1.0')).toThrow(
      'Expected SEA version',
    )
    expect(() => currentPrereleaseVersion('2.1.0-beta.1')).toThrow(
      'Expected SEA version',
    )
    expect(() => currentPrereleaseVersion('2.2.0-rc.1')).toThrow(
      'Expected SEA version',
    )
  })

  it('defines the four stable and prerelease package variants', () => {
    expect(
      makeVariants('2.1.0-rc.3').map(({ artifact }) => artifact),
    ).toEqual([
      'socket-1.14.1.tgz',
      'socket-2.1.0-rc.3.tgz',
      '@socketsecurity-cli-1.14.1.tgz',
      '@socketsecurity-cli-with-sentry-1.14.1.tgz',
    ])
  })

  it('changes only the package name and version and reads packed metadata', () => {
    const raw =
      '{\n  "name": "socket",\n  "version": "2.1.0-rc.0",\n  "private": true\n}\n'
    expect(JSON.parse(updateRootManifest(raw, '1.14.1'))).toEqual({
      name: 'socket',
      version: '1.14.1',
      private: true,
    })
    const bytes = tarEntry(
      'package/package.json',
      '{"name":"socket","version":"1.14.1","bin":{"socket":"bin/cli.js","socket-npm":"bin/npm-cli.js","socket-npx":"bin/npx-cli.js","socket-pnpm":"bin/pnpm-cli.js","socket-yarn":"bin/yarn-cli.js"}}',
    )
    const manifest = readPackagedManifest(bytes)
    expect(manifest).toMatchObject({
      name: 'socket',
      version: '1.14.1',
    })
    expect(() =>
      validatePackagedManifest(
        { ...manifest, bin: { socket: 'wrong.js' } },
        makeVariants('2.1.0-rc.0')[0]!,
      ),
    ).toThrow('CLI bin map mismatch')
    expect(() =>
      validatePackagedManifest(
        manifest,
        makeVariants('2.1.0-rc.0')[0]!,
      ),
    ).not.toThrow()
  })

  it('validates the legacy CLI bin alias on the scoped package', () => {
    const variant = makeVariants('2.1.0-rc.0')[2]!
    const standardBins = {
      socket: 'bin/cli.js',
      'socket-npm': 'bin/npm-cli.js',
      'socket-npx': 'bin/npx-cli.js',
      'socket-pnpm': 'bin/pnpm-cli.js',
      'socket-yarn': 'bin/yarn-cli.js',
    }
    expect(() =>
      validatePackagedManifest(
        {
          name: '@socketsecurity/cli',
          version: '1.14.1',
          bin: { cli: 'bin/cli.js', ...standardBins },
        },
        variant,
      ),
    ).not.toThrow()
  })

  it('requires pnpm to keep its virtual store inside the private workspace', () => {
    const workspace = '/tmp/private-package-workspace'
    expect(() => validatePrivateVirtualStore(workspace, '.pnpm')).not.toThrow()
    expect(() =>
      validatePrivateVirtualStore(
        workspace,
        '../../../../shared/pnpm/store/links',
      ),
    ).toThrow('pnpm virtual store escaped the private workspace')
  })

  it('keeps a nested pnpm install local despite user-level global-store settings', async () => {
    const workspace = await mkdtemp(
      path.join(os.tmpdir(), 'matrix-private-pnpm-test-'),
    )
    const userConfig = path.join(workspace, 'user.npmrc')
    const fixturePackage = path.join(workspace, 'fixture-package')
    await mkdir(fixturePackage)
    await writeFile(
      path.join(fixturePackage, 'package.json'),
      JSON.stringify({ name: 'matrix-local-fixture', version: '1.0.0' }),
    )
    await writeFile(
      path.join(fixturePackage, 'index.js'),
      'module.exports = 1\n',
    )
    await writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'matrix-private-pnpm-test',
        version: '1.0.0',
        packageManager: 'pnpm@10.33.0',
        dependencies: { 'matrix-local-fixture': 'file:./fixture-package' },
      }),
    )
    await writeFile(path.join(workspace, '.npmrc'), 'audit=false\n')
    await writeFile(userConfig, 'enable-global-virtual-store=true\n')
    const env = createPrivatePnpmEnvironment(workspace, {
      ...process.env,
      npm_config_userconfig: userConfig,
      NPM_CONFIG_USERCONFIG: userConfig,
    })
    try {
      run(
        workspace,
        'pnpm',
        [
          'install',
          '--offline',
          '--ignore-scripts',
          '--config.enable-global-virtual-store=false',
          '--virtual-store-dir=node_modules/.pnpm',
        ],
        env,
      )
      await verifyPrivateVirtualStore(workspace)
      run(
        workspace,
        'pnpm',
        [
          'install',
          '--offline',
          '--frozen-lockfile=false',
          '--config.confirmModulesPurge=false',
        ],
        env,
      )
      await verifyPrivateVirtualStore(workspace)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  it.skipIf(process.platform !== 'win32')(
    'launches a pnpm.cmd shim through cross-spawn',
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), 'matrix-pnpm-shim-test-'),
      )
      const marker = path.join(directory, 'launched.txt')
      const shim = path.join(directory, 'pnpm.cmd')
      await writeFile(
        shim,
        '@echo off\r\necho launched> "%MATRIX_PNPM_SHIM_MARKER%"\r\n',
      )
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key.toLowerCase() !== 'path',
        ),
      ) as NodeJS.ProcessEnv
      env.PATH = `${directory}${path.delimiter}${process.env['PATH'] ?? ''}`
      env.MATRIX_PNPM_SHIM_MARKER = marker
      try {
        run(directory, 'pnpm', ['--version'], env)
        await expect(readFile(marker, 'utf8')).resolves.toContain('launched')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )

  it('stages tracked and intentional untracked source without ignored outputs', () => {
    const require = createRequire(import.meta.url)
    const { execFileSync } =
      require('node:child_process') as typeof import('node:child_process')
    const { fileURLToPath } = require('node:url') as typeof import('node:url')
    const root = fileURLToPath(new URL('..', import.meta.url))
    const ignored = execFileSync(
      'git',
      ['check-ignore', '-v', 'build/sea/check'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(ignored).toContain('/build/')
    const allowlisted = execFileSync(
      'git',
      ['check-ignore', '--no-index', '-v', 'scripts/build-package-matrix.mts'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(allowlisted).toContain('!/scripts/build-package-matrix.mts')
    const workflowAllowlisted = execFileSync(
      'git',
      ['check-ignore', '--no-index', '-v', '.github/workflows/ci.yml'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(workflowAllowlisted).toContain('!/.github/workflows/ci.yml')
  })
})
