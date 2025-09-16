import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  findSocketYmlSync,
  overrideCachedConfig,
  updateConfigValue,
} from './config.mts'
import { testPath } from '../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/utils/config')

describe('utils/config', () => {
  describe('updateConfigValue', () => {
    beforeEach(() => {
      overrideCachedConfig({})
    })

    it('should return object for applying a change', () => {
      expect(
        updateConfigValue('defaultOrg', 'fake_test_org'),
      ).toMatchInlineSnapshot(`
        {
          "data": "Change applied but not persisted; current config is overridden through env var or flag",
          "message": "Config key 'defaultOrg' was updated",
          "ok": true,
        }
      `)
    })

    it('should warn for invalid key', () => {
      expect(
        updateConfigValue(
          // @ts-ignore
          'nawthiswontwork',
          'fake_test_org',
        ),
      ).toMatchInlineSnapshot(`
        {
          "data": undefined,
          "message": "Invalid config key: nawthiswontwork",
          "ok": false,
        }
      `)
    })
  })

  describe('findSocketYmlSync', () => {
    it('should handle when no socket.yml exists (regression test for .parsed access)', () => {
      // This test ensures we don't regress on the error:
      // "Cannot read properties of undefined (reading 'parsed')"
      // when socketYmlResult.data is undefined.
      const result = findSocketYmlSync(path.join(fixtureBaseDir, 'nonexistent'))

      // The result should be ok but with undefined data.
      expect(result.ok).toBe(true)
      expect(result.data).toBe(undefined)
    })
  })
})
