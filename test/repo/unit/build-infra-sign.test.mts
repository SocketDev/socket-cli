/**
 * @file Tests for the pure Developer ID codesign argument builder in
 *   `../../../packages/build-infra/lib/sign.mts`. `selectCodesignArgs` takes
 *   no filesystem or process action, so its identity precedence
 *   (explicit > env > literal default) and flag composition (hardened
 *   runtime, entitlements) are fully verifiable without a real certificate
 *   or `codesign` invocation.
 */

import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { selectCodesignArgs } from '../../../packages/build-infra/lib/sign.mts'

const EXAMPLE_BINARY_PATH = '/tmp/example-binary'
const EXAMPLE_IDENTITY = 'Developer ID Application: Example Corp (ABCDE12345)'

describe(selectCodesignArgs, () => {
  it('defaults to the Socket Inc. Developer ID identity when unset', () => {
    const original = process.env['APPLE_DEVELOPER_ID_IDENTITY']
    delete process.env['APPLE_DEVELOPER_ID_IDENTITY']

    try {
      expect(selectCodesignArgs(EXAMPLE_BINARY_PATH, {})).toEqual([
        '--sign',
        'Developer ID Application: Socket Inc. (PZRCDQ736X)',
        '--force',
        '--timestamp',
        '--options',
        'runtime',
        EXAMPLE_BINARY_PATH,
      ])
    } finally {
      if (original === undefined) {
        delete process.env['APPLE_DEVELOPER_ID_IDENTITY']
      } else {
        process.env['APPLE_DEVELOPER_ID_IDENTITY'] = original
      }
    }
  })

  it('prefers APPLE_DEVELOPER_ID_IDENTITY over the literal default', () => {
    const original = process.env['APPLE_DEVELOPER_ID_IDENTITY']
    process.env['APPLE_DEVELOPER_ID_IDENTITY'] = EXAMPLE_IDENTITY

    try {
      const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {})
      expect(args[1]).toBe(EXAMPLE_IDENTITY)
    } finally {
      if (original === undefined) {
        delete process.env['APPLE_DEVELOPER_ID_IDENTITY']
      } else {
        process.env['APPLE_DEVELOPER_ID_IDENTITY'] = original
      }
    }
  })

  it('prefers an explicit identity over the environment variable', () => {
    const original = process.env['APPLE_DEVELOPER_ID_IDENTITY']
    process.env['APPLE_DEVELOPER_ID_IDENTITY'] =
      'Developer ID Application: Env Corp (ZZZZZ99999)'

    try {
      const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {
        identity: EXAMPLE_IDENTITY,
      })
      expect(args[1]).toBe(EXAMPLE_IDENTITY)
    } finally {
      if (original === undefined) {
        delete process.env['APPLE_DEVELOPER_ID_IDENTITY']
      } else {
        process.env['APPLE_DEVELOPER_ID_IDENTITY'] = original
      }
    }
  })

  it('includes --entitlements when entitlementsPath is set', () => {
    const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {
      entitlementsPath: '/tmp/example.entitlements',
      identity: EXAMPLE_IDENTITY,
    })

    expect(args).toEqual([
      '--sign',
      EXAMPLE_IDENTITY,
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      '/tmp/example.entitlements',
      EXAMPLE_BINARY_PATH,
    ])
  })

  it('omits --entitlements when entitlementsPath is unset', () => {
    const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {
      identity: EXAMPLE_IDENTITY,
    })

    expect(args).not.toContain('--entitlements')
  })

  it('omits --options runtime when hardenedRuntime is false', () => {
    const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {
      hardenedRuntime: false,
      identity: EXAMPLE_IDENTITY,
    })

    expect(args).toEqual([
      '--sign',
      EXAMPLE_IDENTITY,
      '--force',
      '--timestamp',
      EXAMPLE_BINARY_PATH,
    ])
  })

  it('includes --options runtime when hardenedRuntime is true', () => {
    const args = selectCodesignArgs(EXAMPLE_BINARY_PATH, {
      hardenedRuntime: true,
      identity: EXAMPLE_IDENTITY,
    })

    expect(args).toContain('--options')
    expect(args).toContain('runtime')
  })
})
