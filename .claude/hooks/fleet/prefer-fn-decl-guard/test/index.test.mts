import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findConstFnExpressions, isExemptPath } from '../index.mts'

describe('findConstFnExpressions', () => {
  it('flags top-level export const arrow', () => {
    const src = `export const foo = () => 42\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 1)
    assert.equal(findings[0]!.name, 'foo')
    assert.equal(findings[0]!.line, 1)
  })

  it('flags top-level const arrow without export', () => {
    const src = `const foo = () => 42\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 1)
    assert.equal(findings[0]!.name, 'foo')
  })

  it('flags export const function expression', () => {
    const src = `export const foo = function () { return 42 }\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 1)
    assert.equal(findings[0]!.name, 'foo')
  })

  it('flags export const async arrow', () => {
    const src = `export const foo = async () => 42\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 1)
  })

  it('flags export const generator function expression', () => {
    const src = `export const foo = function* () { yield 1 }\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 1)
  })

  it('passes export function declaration', () => {
    const src = `export function foo() { return 42 }\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('passes indented const arrow (not module-scope)', () => {
    const src = `function outer() {\n  const inner = () => 42\n  return inner\n}\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('passes const arrow with TS type annotation', () => {
    const src = `const foo: () => number = () => 42\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('passes export const arrow with TS type annotation', () => {
    const src = `export const foo: Handler = () => 42\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('passes non-function const', () => {
    const src = `export const FOO = 42\nexport const BAR = "string"\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('passes object literal assignment', () => {
    const src = `export const config = { foo: () => 42 }\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 0)
  })

  it('flags multiple in same file', () => {
    const src = `export const a = () => 1\nexport const b = () => 2\n`
    const findings = findConstFnExpressions(src)
    assert.equal(findings.length, 2)
    assert.deepEqual(
      findings.map(f => f.name),
      ['a', 'b'],
    )
  })
})

describe('isExemptPath', () => {
  it('exempts dist/', () => {
    assert.equal(isExemptPath('/foo/dist/bar.js'), true)
  })

  it('exempts node_modules/', () => {
    assert.equal(isExemptPath('/foo/node_modules/bar.js'), true)
  })

  it('exempts _internal/', () => {
    assert.equal(isExemptPath('/foo/_internal/bar.mts'), true)
  })

  it('exempts hook own tests', () => {
    assert.equal(
      isExemptPath(
        '/foo/.claude/hooks/fleet/prefer-fn-decl-guard/test/x.mts',
      ),
      true,
    )
  })

  it('exempts oxlint rule + test fixtures', () => {
    assert.equal(
      isExemptPath(
        '/foo/.config/fleet/oxlint-plugin/rules/prefer-function-declaration.mts',
      ),
      true,
    )
    assert.equal(
      isExemptPath(
        '/foo/.config/fleet/oxlint-plugin/test/prefer-function-declaration.test.mts',
      ),
      true,
    )
  })

  it('does not exempt regular source', () => {
    assert.equal(isExemptPath('/foo/src/bar.mts'), false)
  })
})
