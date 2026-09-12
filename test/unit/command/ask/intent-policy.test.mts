import { expect, it } from 'vitest'
import {
  assessAskQuery,
  isAskPackageName,
} from '../../../../src/command/ask/intent-policy.mts'

it.each([
  'no fixes please',
  'do not fix vulnerabilities',
  "don't scan this project",
  'never patch dependencies',
  'scan without changing files',
])('refuses supported negation: %s', query => {
  expect(assessAskQuery(query)).toBe('negated')
})
it.each([
  'fix vulnerabilities, list issues',
  'check lodash, check express',
  'fix vulnerabilities then list issues',
  'check lodash and check express',
  'scan or optimize dependencies',
  'scan and fix vulnerabilities',
  'optimize then patch dependencies',
  'scan; rm -rf example',
  'fix && update',
  'check `example`',
])('refuses ambiguous requests: %s', query => {
  expect(assessAskQuery(query)).toBe('ambiguous')
})
it.each([
  'scan for vulnerabilities and risks',
  'scan for vulnerabilities',
  'fix critical issues',
  'is express safe',
  'optimize dependencies',
])('preserves one supported request: %s', query => {
  expect(assessAskQuery(query)).toBeUndefined()
})
it.each(['', ' ', 'query'.repeat(1025)])(
  'refuses empty or oversized input',
  query => {
    expect(assessAskQuery(query)).toBe('invalid-query')
  },
)
it.each(['express', '@example/package', 'example.module', 'example_package'])(
  'accepts a package argument: %s',
  name => {
    expect(isAskPackageName(name)).toBe(true)
  },
)
it.each([
  '--help',
  'example;scan',
  'example package',
  '../example',
  '@scope/',
  'example'.repeat(32),
])('refuses unsafe package arguments: %s', name => {
  expect(isAskPackageName(name)).toBe(false)
})
