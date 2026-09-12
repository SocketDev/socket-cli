import { expect, it } from 'vitest'

import { describeEntryScript } from '../fixtures/entry-script.mts'

it('describes the bootstrap without fetching packages', () => {
  const description = describeEntryScript(
    'scripts/repo/bootstrap-firewall-deps.mts',
  )
  expect(description.name).toBe('bootstrap-firewall-deps.mts')
  expect(description.description).toContain('bootstrap pinned')
})
