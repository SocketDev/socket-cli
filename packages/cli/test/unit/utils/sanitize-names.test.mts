import { describe, expect, it } from 'vitest'

import { extractName, extractOwner } from '../../../src/src/utils/sanitize-names.mts'

describe('extract-names utilities', () => {
  describe('extractName', () => {
    it('returns valid names unchanged', () => {
      expect(extractName('valid-name')).toBe('valid-name')
      expect(extractName('valid_name')).toBe('valid_name')
      expect(extractName('valid.name')).toBe('valid.name')
      expect(extractName('ValidName123')).toBe('ValidName123')
    })

    it('replaces illegal characters with underscores', () => {
      expect(extractName('name@with#special$chars')).toBe(
        'name_with_special_chars',
      )
      expect(extractName('name with spaces')).toBe('name_with_spaces')
      expect(extractName('name/with/slashes')).toBe('name_with_slashes')
      expect(extractName('name\\with\\backslashes')).toBe(
        'name_with_backslashes',
      )
    })

    it('replaces multiple consecutive special chars with single underscore', () => {
      expect(extractName('name...test')).toBe('name_test')
      expect(extractName('name___test')).toBe('name_test')
      expect(extractName('name---test')).toBe('name_test')
      expect(extractName('name.-.test')).toBe('name_test')
    })

    it('removes leading special characters', () => {
      expect(extractName('.leading-dot')).toBe('leading-dot')
      expect(extractName('-leading-dash')).toBe('leading-dash')
      expect(extractName('_leading-underscore')).toBe('leading-underscore')
      expect(extractName('...leading-dots')).toBe('leading-dots')
    })

    it('removes trailing special characters', () => {
      expect(extractName('trailing-dot.')).toBe('trailing-dot')
      expect(extractName('trailing-dash-')).toBe('trailing-dash')
      expect(extractName('trailing-underscore_')).toBe('trailing-underscore')
      expect(extractName('trailing-dots...')).toBe('trailing-dots')
    })

    it('truncates names longer than 100 characters', () => {
      const longName = 'a'.repeat(150)
      const result = extractName(longName)
      expect(result).toBe('a'.repeat(100))
      expect(result.length).toBe(100)
    })

    it('handles complex sanitization scenarios', () => {
      expect(extractName('@scope/package-name')).toBe('scope_package-name')
      expect(extractName('!!!special!!!name!!!')).toBe('special_name')
      expect(extractName('...---___test___---...')).toBe('test')
    })

    it('returns default repository for empty string', () => {
      expect(extractName('')).toBe('socket-default-repository')
    })

    it('returns default repository when sanitization results in empty string', () => {
      expect(extractName('...')).toBe('socket-default-repository')
      expect(extractName('---')).toBe('socket-default-repository')
      expect(extractName('___')).toBe('socket-default-repository')
      expect(extractName('!@#$%^&*()')).toBe('socket-default-repository')
    })

    it('handles Unicode characters', () => {
      expect(extractName('emoji-🚀-name')).toBe('emoji_name')
      expect(extractName('中文名称')).toBe('socket-default-repository')
      expect(extractName('name-with-émojis')).toBe('name-with_mojis')
    })

    it('preserves case', () => {
      expect(extractName('CamelCase')).toBe('CamelCase')
      expect(extractName('UPPERCASE')).toBe('UPPERCASE')
      expect(extractName('lowercase')).toBe('lowercase')
      expect(extractName('MiXeD-CaSe')).toBe('MiXeD-CaSe')
    })
  })

  describe('extractOwner', () => {
    it('returns valid owner names', () => {
      expect(extractOwner('valid-owner')).toBe('valid-owner')
      expect(extractOwner('valid_owner')).toBe('valid_owner')
      expect(extractOwner('valid.owner')).toBe('valid.owner')
      expect(extractOwner('ValidOwner123')).toBe('ValidOwner123')
    })

    it('sanitizes owner names like extractName', () => {
      expect(extractOwner('owner@with#special')).toBe('owner_with_special')
      expect(extractOwner('owner with spaces')).toBe('owner_with_spaces')
      expect(extractOwner('.leading-dot')).toBe('leading-dot')
      expect(extractOwner('trailing-dot.')).toBe('trailing-dot')
    })

    it('returns undefined for empty input', () => {
      expect(extractOwner('')).toBeUndefined()
    })

    it('returns undefined when sanitization results in empty string', () => {
      expect(extractOwner('...')).toBeUndefined()
      expect(extractOwner('---')).toBeUndefined()
      expect(extractOwner('___')).toBeUndefined()
      expect(extractOwner('!@#$%^&*()')).toBeUndefined()
    })

    it('truncates owner names longer than 100 characters', () => {
      const longOwner = 'o'.repeat(150)
      const result = extractOwner(longOwner)
      expect(result).toBe('o'.repeat(100))
      expect(result?.length).toBe(100)
    })

    it('handles organization names from npm scopes', () => {
      expect(extractOwner('@organization')).toBe('organization')
      expect(extractOwner('@my-org/package')).toBe('my-org_package')
    })

    it('handles GitHub-style owner names', () => {
      expect(extractOwner('github-user')).toBe('github-user')
      expect(extractOwner('org-name-123')).toBe('org-name-123')
    })

    it('does not use default repository for owners', () => {
      // Unlike extractName, extractOwner returns undefined instead of default.
      expect(extractOwner('!!!')).toBeUndefined()
    })
  })
})
