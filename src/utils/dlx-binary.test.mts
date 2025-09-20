import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getDlxCachePath, getSocketHomePath } from './dlx-binary.mts'
import { InputError } from './errors.mts'

describe('dlx-binary simple tests', () => {
  describe('getSocketHomePath', () => {
    it('should return correct path', () => {
      const result = getSocketHomePath()
      expect(result).toBe(path.join(os.homedir(), '.socket'))
    })

    it('should throw error when home directory cannot be determined', () => {
      const originalHomedir = os.homedir
      os.homedir = vi.fn(() => '')

      expect(() => getSocketHomePath()).toThrow(
        new InputError('Unable to determine home directory'),
      )

      os.homedir = originalHomedir
    })
  })

  describe('getDlxCachePath', () => {
    it('should return correct cache path', () => {
      const result = getDlxCachePath()
      expect(result).toBe(path.join(os.homedir(), '.socket', 'cache', 'dlx'))
    })
  })
})
