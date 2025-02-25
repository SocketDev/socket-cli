import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { isErrnoException } from './dist/errors'

const testPath = __dirname

describe('Error Narrowing', () => {
  it('should properly detect node errors', () => {
    try {
      readFileSync(path.join(testPath, 'enoent'))
    } catch (e) {
      assert.equal(isErrnoException(e), true)
    }
  })
  it('should properly only detect node errors', () => {
    assert.equal(isErrnoException(new Error()), false)
    assert.equal(isErrnoException({ ...new Error() }), false)
  })
})
