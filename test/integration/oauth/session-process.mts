import assert from 'node:assert/strict'
import {
  appendFile,
  readFile,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { isMainModule } from '../../../scripts/fleet/process/is-main-module.mts'

import { deleteSocketOAuthCredential } from '@socketsecurity/lib-stable/secrets/socket-oauth'

import {
  getConfigDirectory,
  getConfigValueOrUndef,
} from '../../../src/util/config.mts'
import {
  clearOAuthSession,
  oauthRefreshMarker,
  readOAuthSession,
  saveOAuthSession,
} from '../../../src/util/socket/oauth-session.mts'
import { queryApiSafeText } from '../../../src/util/socket/api-query.mts'
import { sendApiRequest } from '../../../src/util/socket/api-send.mts'
import { setupSdk } from '../../../src/util/socket/sdk.mts'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

async function runSessionProcess(): Promise<void> {
  const { 0: action, 1: issuer, 2: clientId } = process.argv.slice(2)
  assert.ok(issuer)
  assert.ok(clientId)
  const options = { clientId, issuer }
  const apiBaseUrl = new URL('/v0/', issuer).href

  if (action === 'save' || action === 'save-fresh') {
    await saveOAuthSession(options, {
      accessToken:
        action === 'save-fresh'
          ? 'REDACTED_ROTATED_ACCESS'
          : 'REDACTED_EXPIRED_ACCESS',
      refreshToken: 'REDACTED_INITIAL_REFRESH',
      expiresIn: action === 'save-fresh' ? 900 : 1,
      tokenType: 'Bearer',
    })
    const directory = getConfigDirectory()
    assert.ok(directory)
    const content = Buffer.from(
      await readFile(path.join(directory, 'config.json'), 'utf8'),
      'base64',
    ).toString('utf8')
    assert.ok(!content.includes('REDACTED_'))
    assert.ok(getConfigValueOrUndef('oauthSession')?.sessionId)
  } else if (action === 'read') {
    const credential = await readOAuthSession(apiBaseUrl)
    assert.ok(credential)
    assert.equal(credential.token, 'REDACTED_ROTATED_ACCESS')
    assert.equal(credential.authScheme, 'bearer')
  } else if (action === 'missing') {
    await assert.rejects(readOAuthSession(apiBaseUrl))
  } else if (action === 'logout') {
    await clearOAuthSession()
    assert.equal(await readOAuthSession(apiBaseUrl), undefined)
  } else if (action === 'pending') {
    await writeFile(oauthRefreshMarker(options), '', { mode: 0o600 })
  } else if (action === 'blocked-marker') {
    const marker = oauthRefreshMarker(options)
    await symlink(marker, marker)
    await assert.rejects(readOAuthSession(apiBaseUrl), error => {
      return error instanceof Error && 'code' in error && error.code === 'ELOOP'
    })
    await clearOAuthSession()
  } else if (action === 'raw') {
    assert.ok((await queryApiSafeText('organizations')).ok)
    assert.ok((await sendApiRequest('full-scans', 'POST', { body: {} })).ok)
  } else if (action === 'sdk-unsupported') {
    const result = await setupSdk({ apiBaseUrl })
    assert.equal(result.ok, false)
    await clearOAuthSession()
  } else if (action === 'sdk') {
    const result = await setupSdk({ apiBaseUrl })
    assert.ok(result.ok)
    const sdk = result.data
    assert.ok(sdk)
    await sdk.getOrganizations()
    await sdk.getOrganizations()
    await clearOAuthSession()
    await assert.rejects(sdk.getOrganizations())
  } else if (action === 'cleanup') {
    await deleteSocketOAuthCredential(options)
  } else {
    throw new Error('Unknown OAuth integration operation')
  }
}

const KEYCHAIN_OPERATIONS = new Map<string, 'read' | 'write' | 'delete'>([
  ['secret-tool:clear', 'delete'],
  ['secret-tool:lookup', 'read'],
  ['secret-tool:store', 'write'],
  ['security:add-generic-password', 'write'],
  ['security:delete-generic-password', 'delete'],
  ['security:find-generic-password', 'read'],
])

async function writeKeychainFixture(
  file: string,
  args: string[],
  executable: string,
): Promise<void> {
  let value = ''
  if (executable === 'security') {
    const argument = args[args.indexOf('-w') + 1]
    assert.ok(argument)
    value = argument
  } else {
    for await (const chunk of process.stdin) {
      value += String(chunk)
    }
  }
  assert.ok(value)
  const temporary = `${file}.${process.pid}`
  await writeFile(temporary, value, { mode: 0o600 })
  await rename(temporary, file)
}

export async function runKeychainFixture(): Promise<void> {
  const directory = getEnvValue('SOCKET_OAUTH_TEST_KEYCHAIN')
  const expectedAccount = getEnvValue('SOCKET_OAUTH_TEST_ACCOUNT')
  assert.ok(directory)
  assert.ok(path.isAbsolute(directory))
  assert.ok(expectedAccount)
  assert.ok(/^[a-f0-9]{64}$/u.test(expectedAccount))
  const args = process.argv.slice(2)
  const executable = path.basename(process.argv[1] ?? '')
  assert.ok(executable === 'secret-tool' || executable === 'security')
  const command = args[0]
  if (executable === 'secret-tool' && command === '--version') {
    return
  }
  const macOS = executable === 'security'
  const service = args[args.indexOf(macOS ? '-s' : 'service') + 1]
  const account = args[args.indexOf(macOS ? '-a' : 'user') + 1]
  assert.equal(service, 'socketsecurity-oauth')
  assert.ok(account)
  assert.equal(account, expectedAccount)
  const file = path.join(directory, account)
  const operation = KEYCHAIN_OPERATIONS.get(`${executable}:${command}`)
  assert.ok(operation)
  await appendFile(path.join(directory, 'operations'), `${operation}\n`, {
    mode: 0o600,
  })
  if (operation === 'write') {
    await writeKeychainFixture(file, args, executable)
    return
  }
  try {
    if (operation === 'read') {
      // oxlint-disable-next-line socket/no-direct-stream-write -- keychain protocol bytes
      process.stdout.write(await readFile(file, 'utf8'))
    } else {
      await safeDelete(file, { allowedDirs: [directory] })
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      process.exitCode = macOS ? 44 : 1
    } else {
      throw error
    }
  }
}

if (isMainModule(import.meta.url)) {
  runSessionProcess().catch(error => {
    logger.fail(error)
    process.exitCode = 1
  })
}
