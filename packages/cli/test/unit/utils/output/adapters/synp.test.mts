/**
 * Unit tests for the synp scrubber adapter.
 *
 * Drops "Created <path>" success lines and the commander "use --help"
 * footer; passes everything else through untouched.
 *
 * Related Files:
 * - src/utils/output/adapters/synp.mts
 */

import { describe, expect, it } from 'vitest'

import { synpAdapter } from '../../../../../src/utils/output/adapters/synp.mts'

describe('synpAdapter', () => {
  it('exposes the synp name', () => {
    expect(synpAdapter.name).toBe('synp')
  })

  it('drops "Created <path>" success lines', () => {
    expect(synpAdapter.classify('Created /tmp/yarn.lock')).toBe('drop')
    expect(synpAdapter.classify('  Created package-lock.json  ')).toBe('drop')
  })

  it('drops the commander "use --help for hints" footer', () => {
    expect(synpAdapter.classify('use --help for hints')).toBe('drop')
    expect(synpAdapter.classify('  use --help for hints  ')).toBe('drop')
  })

  it('returns undefined for empty/whitespace-only lines', () => {
    expect(synpAdapter.classify('')).toBeUndefined()
    expect(synpAdapter.classify('   ')).toBeUndefined()
    expect(synpAdapter.classify('\t')).toBeUndefined()
  })

  it('returns undefined for unknown lines', () => {
    expect(synpAdapter.classify('error: invalid input')).toBeUndefined()
    expect(synpAdapter.classify('some other text')).toBeUndefined()
  })

  it('does not drop lines that merely start with "Created" without trailing content', () => {
    // The regex requires a non-whitespace token after "Created".
    expect(synpAdapter.classify('Created')).toBeUndefined()
  })
})
