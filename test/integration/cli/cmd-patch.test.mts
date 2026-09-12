import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getBinCliPath } from '../../../src/constants/paths.mts'
import { spawnSocketCli } from '../../utils.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const binCliPath = getBinCliPath()
let fixtureDir: string
let fixturePath: string

beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'socket-patch-forwarding-'))
  fixturePath = path.join(fixtureDir, 'patch-fixture.cjs')
  writeFileSync(
    fixturePath,
    'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = Number(process.env.PATCH_FIXTURE_EXIT_CODE || 0)',
  )
})

afterAll(async () => {
  await safeDelete(fixtureDir)
})

describe('socket patch', () => {
  it('shows root help', async () => {
    const result = await spawnSocketCli(binCliPath, [
      'patch',
      '--help',
      '--config',
      '{}',
      '--no-banner',
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Manage CVE patches for dependencies')
  })

  it('requires a subcommand', async () => {
    const result = await spawnSocketCli(binCliPath, [
      'patch',
      '--config',
      '{}',
      '--no-banner',
    ])
    expect(result.code).toBe(2)
    expect(result.stdout).toContain('Manage CVE patches for dependencies')
  })

  it.each([
    'scan',
    'list',
    'apply',
    'get',
    'remove',
    'repair',
    'rollback',
    'setup',
    'vendor',
    'vex',
  ])('forwards %s and filters global flags', async subcommand => {
    const result = await spawnSocketCli(
      binCliPath,
      ['patch', subcommand, '--help', '--config', '{}', '--no-banner'],
      { env: { SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH: fixturePath } },
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([subcommand, '--help'])
  })

  it('preserves the patch process exit status', async () => {
    const result = await spawnSocketCli(
      binCliPath,
      ['patch', 'apply', '--config', '{}', '--no-banner'],
      {
        env: {
          SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH: fixturePath,
          PATCH_FIXTURE_EXIT_CODE: '7',
        },
      },
    )
    expect(result.code).toBe(7)
    expect(JSON.parse(result.stdout)).toEqual(['apply'])
  })
})
