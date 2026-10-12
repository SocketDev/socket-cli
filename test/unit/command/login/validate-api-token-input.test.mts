import { describe, expect, it } from 'vitest'
import { classifyLoginTokenInput } from '../../../../src/command/login/validate-api-token-input.mts'

describe('classifyLoginTokenInput', () => {
  it('classifies an undefined input as cancellation', () => {
    expect(classifyLoginTokenInput(undefined)).toEqual({ kind: 'cancelled' })
  })

  it.each(['', ' ', '\t\n', '\u00a0\u2003'])(
    'classifies %j as blank',
    input => {
      expect(classifyLoginTokenInput(input)).toEqual({ kind: 'blank' })
    },
  )

  it('preserves a supplied token exactly', () => {
    expect(classifyLoginTokenInput(' token ')).toEqual({
      kind: 'supplied',
      token: ' token ',
    })
  })

  it('classifies an ordinary synthetic token as supplied', () => {
    expect(classifyLoginTokenInput('synthetic-api-token')).toEqual({
      kind: 'supplied',
      token: 'synthetic-api-token',
    })
  })
})
