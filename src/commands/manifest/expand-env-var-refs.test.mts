import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  expandEnvVarRefs,
  formatMissingEnvVarRefs,
} from './expand-env-var-refs.mts'

const VAR_A = 'SOCKET_TEST_EXPAND_ENV_VAR_A'
const VAR_B = 'SOCKET_TEST_EXPAND_ENV_VAR_B'

describe('expandEnvVarRefs', () => {
  beforeEach(() => {
    delete process.env[VAR_A]
    delete process.env[VAR_B]
  })
  afterEach(() => {
    delete process.env[VAR_A]
    delete process.env[VAR_B]
  })

  it('expands a bare $VAR reference', () => {
    process.env[VAR_A] = '/opt/jdk-17'
    expect(expandEnvVarRefs(`$${VAR_A}`)).toEqual({ value: '/opt/jdk-17' })
  })

  it('expands a braced ${VAR} reference', () => {
    process.env[VAR_A] = '/opt/jdk-17'
    expect(expandEnvVarRefs(`\${${VAR_A}}`)).toEqual({ value: '/opt/jdk-17' })
  })

  it('reports every distinct missing variable, not just the first', () => {
    const result = expandEnvVarRefs(`$${VAR_A}/$${VAR_B}`)
    expect(result.missing).toEqual([VAR_A, VAR_B])
    expect(result.value).toBe('/')
  })

  it('reports a missing variable only once even if referenced twice', () => {
    const result = expandEnvVarRefs(`$${VAR_A}:$${VAR_A}`)
    expect(result.missing).toEqual([VAR_A])
  })

  it('treats $$ as an escaped literal $, leaving the following text untouched', () => {
    expect(expandEnvVarRefs('$$HOME')).toEqual({ value: '$HOME' })
  })

  it('treats $$ as an escaped literal $ ahead of a braced-looking reference', () => {
    expect(expandEnvVarRefs('$${HOME}')).toEqual({ value: '${HOME}' })
  })

  it('does not report a missing variable for an escaped $$ reference', () => {
    expect(expandEnvVarRefs(`$$${VAR_A}`).missing).toBeUndefined()
  })
})

describe('formatMissingEnvVarRefs', () => {
  it('uses singular wording for one missing variable', () => {
    expect(formatMissingEnvVarRefs(['FOO'])).toBe(
      'references `FOO`, which is not set in this environment',
    )
  })

  it('uses plural wording for multiple missing variables', () => {
    expect(formatMissingEnvVarRefs(['FOO', 'BAR'])).toBe(
      'references `FOO`, `BAR`, which are not set in this environment',
    )
  })
})
