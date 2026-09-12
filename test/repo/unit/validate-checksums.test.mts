import { expect, it } from 'vitest'

import { describeEntryScript } from '../fixtures/entry-script.mts'

it('describes checksum validation without reading tool metadata', () => {
  const description = describeEntryScript('scripts/repo/validate-checksums.mts')
  expect(description.name).toBe('validate-checksums.mts')
  expect(description.description).toContain('SHA-256 checksum')
})
