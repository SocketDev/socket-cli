import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

import * as helpers from '../lib/utils/type-helpers.cjs'

describe('Error Narrowing', () => {
  it('should properly detect node errors', () => {
    try {
      fs.readFileSync(new URL('./enoent', import.meta.url))
    } catch (e) {
      assert.equal(helpers.isErrnoException(e), true)
    }
  })
  it('should properly only detect node errors', () => {
    assert.equal(helpers.isErrnoException(new Error()), false)
    assert.equal(helpers.isErrnoException({ ...new Error() }), false)
  })
})
