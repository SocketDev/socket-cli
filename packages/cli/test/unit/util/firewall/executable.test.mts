import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveFirewallExecutable } from '../../../../src/util/firewall/executable.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

let directory: string
let temporaryDirectory: string
let checkout: string
let trusted: string
async function fixtureFile(filename: string, content = '#!/bin/sh\nexit 0\n') {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, content)
  await chmod(filename, 0o755)
}

describe('firewall executable resolution', () => {
  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-executable-'),
    )
    directory = await realpath(temporaryDirectory)
    checkout = path.join(directory, 'checkout')
    trusted = path.join(directory, 'trusted')
    await mkdir(path.join(checkout, '.git'), { recursive: true })
    await mkdir(trusted)
  })
  afterEach(async () => {
    await safeDelete(temporaryDirectory, { maxRetries: 0 })
  })
  it('excludes checkout executables from bare-name resolution', async () => {
    await fixtureFile(path.join(checkout, 'cargo'))
    await fixtureFile(path.join(trusted, 'cargo'))
    const result = await resolveFirewallExecutable('cargo', {
      cwd: checkout,
      env: { PATH: [checkout, trusted].join(path.delimiter) },
      windows: false,
    })
    expect(result).toEqual({
      executable: path.join(trusted, 'cargo'),
      prefixArgs: [],
      searchPath: trusted,
    })
  })
  it('allows an explicitly requested checkout script and sanitizes child PATH', async () => {
    await fixtureFile(path.join(checkout, 'gradlew'))
    const result = await resolveFirewallExecutable('./gradlew', {
      cwd: checkout,
      env: { PATH: [checkout, trusted].join(path.delimiter) },
      windows: false,
    })
    expect(result).toEqual({
      executable: path.join(checkout, 'gradlew'),
      prefixArgs: [],
      searchPath: trusted,
    })
  })
  it('rejects missing or non-executable explicit scripts', async () => {
    await writeFile(path.join(checkout, 'gradlew'), 'example')
    expect(
      await resolveFirewallExecutable('./gradlew', {
        cwd: checkout,
        windows: false,
      }),
    ).toBeUndefined()
    expect(
      await resolveFirewallExecutable('./missing', {
        cwd: checkout,
        windows: false,
      }),
    ).toBeUndefined()
  })
  it.each([
    ['npm', ['npm', 'bin', 'npm-cli.js']],
    ['npx', ['npm', 'bin', 'npx-cli.js']],
    ['pnpm', ['pnpm', 'bin', 'pnpm.cjs']],
    ['yarn', ['yarn', 'bin', 'yarn.js']],
  ] as const)(
    'resolves Windows %s through trusted Node without a shell',
    async (command, parts) => {
      const entry = path.join(trusted, 'node_modules', ...parts)
      await fixtureFile(entry, 'process.exit(0)')
      await fixtureFile(path.join(trusted, 'node.exe'))
      await fixtureFile(
        path.join(trusted, `${command}.cmd`),
        `@node "%dp0%\\node_modules\\${parts.join('\\')}" %*`,
      )
      expect(
        await resolveFirewallExecutable(command, {
          cwd: checkout,
          env: { PATH: trusted },
          windows: true,
        }),
      ).toEqual({
        executable: path.join(trusted, 'node.exe'),
        prefixArgs: [entry],
        searchPath: trusted,
      })
    },
  )
  it('rejects a Windows package entry that links into the checkout', async () => {
    await fixtureFile(path.join(trusted, 'node.exe'))
    await fixtureFile(path.join(checkout, 'npm-cli.js'), 'process.exit(0)')
    await mkdir(path.join(trusted, 'node_modules', 'npm', 'bin'), {
      recursive: true,
    })
    await symlink(
      path.join(checkout, 'npm-cli.js'),
      path.join(trusted, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    )
    await fixtureFile(
      path.join(trusted, 'npm.cmd'),
      '@node "%dp0%\\node_modules\\npm\\bin\\npm-cli.js" %*',
    )
    expect(
      await resolveFirewallExecutable('npm', {
        cwd: checkout,
        env: { PATH: trusted },
        windows: true,
      }),
    ).toBeUndefined()
  })
  it('rejects arbitrary batch scripts without enabling shell parsing', async () => {
    await fixtureFile(path.join(checkout, 'gradlew.bat'), '@echo example')
    expect(
      await resolveFirewallExecutable('./gradlew.bat', {
        cwd: checkout,
        windows: true,
      }),
    ).toBeUndefined()
  })
  it('rejects unrecognized package-manager shims', async () => {
    await fixtureFile(path.join(trusted, 'node.exe'))
    await fixtureFile(path.join(trusted, 'npm.cmd'), '@node "unexpected.js" %*')
    expect(
      await resolveFirewallExecutable('npm', {
        cwd: checkout,
        env: { PATH: trusted },
        windows: true,
      }),
    ).toBeUndefined()
  })
})
