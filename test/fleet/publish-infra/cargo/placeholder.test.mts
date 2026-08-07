import { describe, expect, it } from 'vitest'

import { cargoTokenProblem } from '../../../../scripts/fleet/publish-infra/cargo/placeholder.mts'

describe('cargoTokenProblem', () => {
  it('accepts a plausible crates.io token', () => {
    expect(cargoTokenProblem('cioAbC123deadbeef')).toBe(undefined)
  })

  it('flags chat-copied command text saved as the token', () => {
    expect(cargoTokenProblem('! pbpaste | cargo login')).toMatch(/'!'/)
  })

  it('flags whitespace-bearing values', () => {
    expect(cargoTokenProblem('cio abc')).toMatch(/whitespace/)
  })

  it('flags a missing cio prefix', () => {
    expect(cargoTokenProblem('npm_deadbeef')).toMatch(/cio/)
  })

  it('flags the empty string', () => {
    expect(cargoTokenProblem('')).toMatch(/empty/)
  })
})
