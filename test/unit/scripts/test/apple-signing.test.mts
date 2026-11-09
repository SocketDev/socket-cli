import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  persistNativeSigningReceipt,
  prepareNativeTestBinary,
} from '../../../../scripts/test/apple-signing.mts'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-signing-'))
  dirs.push(dir)
  const binaryPath = path.join(dir, 'socket')
  await writeFile(binaryPath, 'unsigned payload')
  const { createHash } = await import('node:crypto')
  const sourceSha256 = createHash('sha256')
    .update('unsigned payload')
    .digest('hex')
  return { binaryPath, sourceSha256 }
}

describe('native test signing policy', () => {
  it('allows unsigned local mode', async () => {
    const file = await fixture()
    expect(
      (await prepareNativeTestBinary({ ...file, env: {}, platform: 'darwin' }))
        .mode,
    ).toBe('unsigned-local')
  })
  it('allows explicitly uncredentialed CI with an unsigned receipt', async () => {
    const file = await fixture()
    expect(
      (
        await prepareNativeTestBinary({
          ...file,
          env: { CI: 'true' },
          platform: 'darwin',
        })
      ).mode,
    ).toBe('unsigned-ci')
  })
  it('signs and verifies configured credentials before issuing a Developer ID receipt', async () => {
    const file = await fixture()
    const calls: string[] = []
    const searchListUpdates: string[][] = []
    let captureOptions:
      | { stdio?: unknown; timeout?: unknown; maxBuffer?: unknown }
      | undefined
    const receipt = await prepareNativeTestBinary({
      ...file,
      platform: 'darwin',
      env: {
        APPLE_DEVELOPER_ID_IDENTITY:
          'Developer ID Application: Example (ABCDEFGHIJ)',
        APPLE_TEAM_ID: 'ABCDEFGHIJ',
        APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12:
          Buffer.from('p12').toString('base64'),
        APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
      },
      runner(command, args, options) {
        calls.push(`${command} ${args.join(' ')}`)
        if (command === 'security' && args[0] === 'list-keychains') {
          if (args[3] === '-s') {
            searchListUpdates.push(args.slice(4))
          }
          return {
            status: 0,
            stdout:
              args[3] === '-s'
                ? ''
                : '    "/Users/example/login.keychain-db"\n',
            stderr: '',
          }
        }
        if (command === 'security' && args[0] === 'find-identity') {
          captureOptions = options
          return {
            status: 0,
            stdout:
              '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"\n',
            stderr: '',
          }
        }
        if (command === 'codesign' && args[0] === '--display') {
          return {
            status: 0,
            stdout: '',
            stderr:
              'Authority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 flags=0x10000(runtime)\n<key>com.apple.security.cs.allow-jit</key><true/>\n<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    expect(calls.some(call => call.includes('codesign --force'))).toBe(true)
    expect(
      calls.some(call => call.startsWith('security delete-keychain ')),
    ).toBe(true)
    expect(calls.some(call => call.includes('--entitlements'))).toBe(true)
    expect(searchListUpdates).toHaveLength(2)
    expect(searchListUpdates[0]).toHaveLength(2)
    expect(searchListUpdates[0][1]).toBe('/Users/example/login.keychain-db')
    expect(searchListUpdates[1]).toEqual(['/Users/example/login.keychain-db'])
    expect(captureOptions?.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(captureOptions?.timeout).toBe(120_000)
    expect(captureOptions?.maxBuffer).toBe(65_536)
    expect(receipt.mode).toBe('developer-id')
  })
  it('rejects partial credentials and failed signing', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: { APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      }),
    ).rejects.toThrow(/incomplete/)
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: { APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'password-only' },
      }),
    ).rejects.toThrow(/incomplete/)
    const calls: string[] = []
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => {
          calls.push(`${command} ${args.join(' ')}`)
          return args[0] === 'delete-keychain'
            ? { status: 0, stdout: '', stderr: '' }
            : { status: 0, stdout: '', stderr: '' }
        },
      }),
    ).rejects.toThrow(/Developer ID identity/)
    expect(
      calls.some(call => call.startsWith('security delete-keychain ')),
    ).toBe(true)
    expect(calls.some(call => call.startsWith('codesign '))).toBe(false)
  })
  it('rejects an ad hoc signature', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => ({
          status: 0,
          stdout:
            command === 'security' && args[0] === 'find-identity'
              ? '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"'
              : '',
          stderr:
            args[0] === '--display'
              ? 'Signature=adhoc\nTeamIdentifier=ABCDEFGHIJ\n'
              : '',
        }),
      }),
    ).rejects.toThrow(/Developer ID Application/)
  })
  it('fails closed when signature is required but credentials are absent', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        env: {
          CI: 'true',
          SOCKET_CLI_NATIVE_TEST_REQUIRE_APPLE_SIGNATURE: '1',
        },
        platform: 'darwin',
      }),
    ).rejects.toThrow(/credentials are missing/)
  })
  it('rejects signatures from another team', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => ({
          status: 0,
          stdout:
            command === 'security' && args[0] === 'find-identity'
              ? '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"'
              : '',
          stderr:
            args[0] === '--display'
              ? 'Authority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ZZZZZZZZZZ\nCodeDirectory v=20500 flags=0x10000(runtime)\n<key>com.apple.security.cs.allow-jit</key><true/>\n<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>'
              : '',
        }),
      }),
    ).rejects.toThrow(/hardened Developer ID/)
  })
  it('reports signing failure distinctly and deletes the temporary keychain', async () => {
    const file = await fixture()
    const calls: string[] = []
    const searchListUpdates: string[][] = []
    let keychainPassword = ''
    let failure: unknown
    try {
      await prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => {
          calls.push(`${command} ${args.join(' ')}`)
          if (command === 'security' && args[0] === 'create-keychain') {
            keychainPassword = args[2]!
          }
          if (command === 'security' && args[0] === 'list-keychains') {
            if (args[3] === '-s') {
              searchListUpdates.push(args.slice(4))
            }
            return {
              status: 0,
              stdout:
                args[3] === '-s' ? '' : '"/Users/example/login.keychain-db"\n',
              stderr: '',
            }
          }
          if (command === 'security' && args[0] === 'find-identity') {
            return {
              status: 0,
              stdout:
                '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"',
              stderr: '',
            }
          }
          if (command === 'codesign' && args[0] === '--force') {
            return {
              status: 1,
              stdout: '',
              stderr: `resource unavailable ${keychainPassword} p12-password cDEy ABCDEFGHIJ`,
            }
          }
          return { status: 0, stdout: '', stderr: '' }
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('resource unavailable')
    expect((failure as Error).message).toContain('exit 1')
    expect((failure as Error).message).not.toContain(keychainPassword)
    expect((failure as Error).message).not.toContain('p12-password')
    expect((failure as Error).message).not.toContain('cDEy')
    expect((failure as Error).message).not.toContain('ABCDEFGHIJ')
    expect(
      calls.some(call => call.startsWith('security delete-keychain ')),
    ).toBe(true)
    expect(searchListUpdates).toHaveLength(2)
    expect(searchListUpdates[1]).toEqual(['/Users/example/login.keychain-db'])
  })
  it('restores the keychain search list when temporary keychain creation fails', async () => {
    const file = await fixture()
    const updates: string[][] = []
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => {
          if (command === 'security' && args[0] === 'list-keychains') {
            if (args[3] === '-s') {
              updates.push(args.slice(4))
            }
            return {
              status: 0,
              stdout:
                args[3] === '-s' ? '' : '"/Users/example/login.keychain-db"\n',
              stderr: '',
            }
          }
          if (command === 'security' && args[0] === 'create-keychain') {
            return { status: 1, stdout: '', stderr: '' }
          }
          return { status: 0, stdout: '', stderr: '' }
        },
      }),
    ).rejects.toThrow(/security create-keychain failed/)
    expect(updates).toEqual([['/Users/example/login.keychain-db']])
  })
  it('preserves signing and cleanup failures together', async () => {
    const file = await fixture()
    let caught: unknown
    try {
      await prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => {
          if (command === 'security' && args[0] === 'find-identity') {
            return {
              status: 0,
              stdout:
                '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"',
              stderr: '',
            }
          }
          if (command === 'codesign' && args[0] === '--force') {
            return { status: 1, stdout: '', stderr: '' }
          }
          if (command === 'security' && args[0] === 'delete-keychain') {
            return { status: 1, stdout: '', stderr: '' }
          }
          return { status: 0, stdout: '', stderr: '' }
        },
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toHaveLength(2)
    expect((caught as AggregateError).errors[0].message).toMatch(
      /codesign --force failed/,
    )
    expect((caught as AggregateError).errors[1].message).toMatch(
      /delete temporary Apple signing keychain/,
    )
  })
  it('rejects an explicit identity that matches ambiguous keychain rows', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_DEVELOPER_ID_IDENTITY:
            'Developer ID Application: Example (ABCDEFGHIJ)',
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => ({
          status: 0,
          stdout:
            command === 'security' && args[0] === 'find-identity'
              ? '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"\n2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Example (ABCDEFGHIJ)"'
              : '',
          stderr: '',
        }),
      }),
    ).rejects.toThrow(/unavailable or ambiguous/)
  })
  it('rejects entitlements that are present but not enabled', async () => {
    const file = await fixture()
    await expect(
      prepareNativeTestBinary({
        ...file,
        platform: 'darwin',
        env: {
          APPLE_TEAM_ID: 'ABCDEFGHIJ',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12: 'cDEy',
          APPLE_DEVELOPER_ID_APPLICATION_CERTS_P12_PASS: 'p12-password',
        },
        runner: (command, args) => ({
          status: 0,
          stdout:
            command === 'security' && args[0] === 'find-identity'
              ? '1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Example (ABCDEFGHIJ)"'
              : '',
          stderr:
            command === 'codesign' && args[0] === '--display'
              ? 'Authority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 flags=0x10000(runtime)\n<key>com.apple.security.cs.allow-jit</key><false/>\n<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>'
              : '',
        }),
      }),
    ).rejects.toThrow(/hardened Developer ID/)
  })
  it('persists only the nonsecret signing receipt fields', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'native-receipt-'))
    dirs.push(dir)
    const receiptPath = path.join(dir, 'build', 'signing-receipt.json')
    await persistNativeSigningReceipt(
      {
        mode: 'developer-id',
        sourceSha256: 'source-digest',
        stagedSha256: 'signed-digest',
        teamId: 'ABCDEFGHIJ',
        authority: 'Developer ID Application: private (ABCDEFGHIJ)',
      },
      receiptPath,
    )
    const { readFile } = await import('node:fs/promises')
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toEqual({
      mode: 'developer-id',
      sourceSha256: 'source-digest',
      stagedSha256: 'signed-digest',
    })
  })
})
