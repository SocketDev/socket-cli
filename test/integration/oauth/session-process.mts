import assert from 'node:assert/strict'
import { readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

runSessionProcess().catch(error => {
  logger.fail(error)
  process.exitCode = 1
})
