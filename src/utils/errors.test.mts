import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isErrnoException } from './errors.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Error Narrowing', () => {
  it('should properly detect node errors', () => {
    try {
      readFileSync(path.join(__dirname, 'enoent'))
    } catch (e) {
      expect(isErrnoException(e)).toBe(true)
    }
  })
  it('should properly only detect node errors', () => {
    expect(isErrnoException(new Error())).toBe(false)
    expect(isErrnoException({ ...new Error() })).toBe(false)
  })
})
