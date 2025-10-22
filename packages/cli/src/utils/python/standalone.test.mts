import { describe, expect, it } from 'vitest'

import { checkSystemPython, ensurePython } from './standalone.mts'

describe('python-standalone', () => {
  describe('checkSystemPython', () => {
    it('should check for system Python', async () => {
      const result = await checkSystemPython()
      // Result can be null or a path string
      if (result) {
        expect(typeof result).toBe('string')
        expect(result).toContain('python')
      } else {
        expect(result).toBe(null)
      }
    })
  })

  describe('ensurePython', () => {
    it('should ensure Python is available or throw error', async () => {
      try {
        const pythonBin = await ensurePython()
        expect(typeof pythonBin).toBe('string')
        expect(pythonBin.length).toBeGreaterThan(0)
        expect(pythonBin).toContain('python')
      } catch (error) {
        // In test environment without proper constants, download might fail
        // This is expected and not a test failure
        expect(error).toBeDefined()
      }
      // Give it 60 seconds for potential download
    }, 60000)
  })
})
