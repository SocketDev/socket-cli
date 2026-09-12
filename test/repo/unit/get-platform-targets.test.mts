import { expect, it } from 'vitest'

import { describeEntryScript } from '../fixtures/entry-script.mts'

it('describes the target generator without printing targets', () => {
  const description = describeEntryScript(
    'scripts/repo/get-platform-targets.mts',
  )
  expect(description.name).toBe('get-platform-targets.mts')
  expect(description.description).toContain('platform targets')
})
