import { expect, it } from 'vitest'

import { describeEntryScript } from '../fixtures/entry-script.mts'

it('describes setup without changing the workspace', () => {
  const description = describeEntryScript('scripts/repo/setup.mts')
  expect(description.name).toBe('setup.mts')
  expect(description.description).toContain('development dependencies')
})
