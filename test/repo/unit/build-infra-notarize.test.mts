/**
 * @file Tests for the pure notarytool argument builder and the env-var
 *   credential reader in `../../../packages/build-infra/lib/notarize.mts`.
 *   `notarizeMachO` itself spawns `ditto`/`xcrun` and is exercised only
 *   manually against a real App Store Connect API key — no test here
 *   invokes either.
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { describe, expect, it } from 'vitest'

import {
  readNotarizeCredentialsFromEnv,
  selectNotarytoolArgs,
} from '../../../packages/build-infra/lib/notarize.mts'

const ENV_VARS = [
  'APPLE_ASC_KEY_ID',
  'APPLE_ASC_ISSUER_ID',
  'APPLE_ASC_KEY_P8_B64',
] as const

function snapshotNotarizeEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {}
  for (const name of ENV_VARS) {
    snapshot[name] = process.env[name]
  }
  return snapshot
}

function restoreNotarizeEnv(snapshot: Record<string, string | undefined>) {
  for (const name of ENV_VARS) {
    const value = snapshot[name]
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

describe(selectNotarytoolArgs, () => {
  it('builds the notarytool submit args in order', () => {
    const args = selectNotarytoolArgs('/tmp/example.zip', {
      issuerId: 'issuer-1234',
      keyId: 'key-5678',
      keyPath: '/tmp/AuthKey.p8',
    })

    expect(args).toEqual([
      'notarytool',
      'submit',
      '/tmp/example.zip',
      '--key',
      '/tmp/AuthKey.p8',
      '--key-id',
      'key-5678',
      '--issuer',
      'issuer-1234',
      '--wait',
      '--output-format',
      'json',
    ])
  })
})

describe(readNotarizeCredentialsFromEnv, () => {
  it('decodes the base64 key to a 0600 file when every var is present', () => {
    const original = snapshotNotarizeEnv()
    process.env['APPLE_ASC_KEY_ID'] = 'key-5678'
    process.env['APPLE_ASC_ISSUER_ID'] = 'issuer-1234'
    process.env['APPLE_ASC_KEY_P8_B64'] = Buffer.from(
      'example-p8-contents',
    ).toString('base64')

    try {
      const credentials = readNotarizeCredentialsFromEnv()
      expect(credentials).toBeDefined()
      if (!credentials) {
        return
      }

      expect(credentials.keyId).toBe('key-5678')
      expect(credentials.issuerId).toBe('issuer-1234')
      expect(readFileSync(credentials.keyPath, 'utf8')).toBe(
        'example-p8-contents',
      )

      // Windows chmod cannot express 0600 (statSync reports 0666 there), so
      // the exact-mode check only holds on POSIX platforms.
      if (process.platform !== 'win32') {
        const mode = statSync(credentials.keyPath).mode & 0o777
        expect(mode).toBe(0o600)
      }

      safeDeleteSync(path.dirname(credentials.keyPath))
    } finally {
      restoreNotarizeEnv(original)
    }
  })

  it('returns undefined when APPLE_ASC_KEY_ID is missing', () => {
    const original = snapshotNotarizeEnv()
    delete process.env['APPLE_ASC_KEY_ID']
    process.env['APPLE_ASC_ISSUER_ID'] = 'issuer-1234'
    process.env['APPLE_ASC_KEY_P8_B64'] = Buffer.from(
      'example-p8-contents',
    ).toString('base64')

    try {
      expect(readNotarizeCredentialsFromEnv()).toBeUndefined()
    } finally {
      restoreNotarizeEnv(original)
    }
  })

  it('returns undefined when APPLE_ASC_ISSUER_ID is missing', () => {
    const original = snapshotNotarizeEnv()
    process.env['APPLE_ASC_KEY_ID'] = 'key-5678'
    delete process.env['APPLE_ASC_ISSUER_ID']
    process.env['APPLE_ASC_KEY_P8_B64'] = Buffer.from(
      'example-p8-contents',
    ).toString('base64')

    try {
      expect(readNotarizeCredentialsFromEnv()).toBeUndefined()
    } finally {
      restoreNotarizeEnv(original)
    }
  })

  it('returns undefined when APPLE_ASC_KEY_P8_B64 is missing', () => {
    const original = snapshotNotarizeEnv()
    process.env['APPLE_ASC_KEY_ID'] = 'key-5678'
    process.env['APPLE_ASC_ISSUER_ID'] = 'issuer-1234'
    delete process.env['APPLE_ASC_KEY_P8_B64']

    try {
      expect(readNotarizeCredentialsFromEnv()).toBeUndefined()
    } finally {
      restoreNotarizeEnv(original)
    }
  })
})
