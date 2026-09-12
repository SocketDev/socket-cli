import { expect, it } from 'vitest'

import { describeEntryScript } from '../fixtures/entry-script.mts'

it('describes the matrix generator without generating a matrix', () => {
  const description = describeEntryScript(
    'scripts/repo/get-platform-matrix.mts',
  )
  expect(description.name).toBe('get-platform-matrix.mts')
  expect(description.description).toContain('platform matrix')
})
