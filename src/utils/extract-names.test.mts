import { describe, expect, it } from 'vitest'

import constants from '../constants.mts'
import { extractName, extractOwner } from './extract-names.mts'

describe('extractName', () => {
  it('should return valid names unchanged', () => {
    expect(extractName('myrepo')).toBe('myrepo')
    expect(extractName('My-Repo_123')).toBe('My-Repo_123')
    expect(extractName('repo.with.dots')).toBe('repo.with.dots')
    expect(extractName('a1b2c3')).toBe('a1b2c3')
  })

  it('should replace sequences of illegal characters with underscore', () => {
    expect(extractName('repo@#$%name')).toBe('repo_name')
    expect(extractName('repo   name')).toBe('repo_name')
    expect(extractName('repo!!!name')).toBe('repo_name')
    expect(extractName('repo/\\|name')).toBe('repo_name')
  })

  it('should replace sequences of multiple allowed special chars with single underscore', () => {
    expect(extractName('repo...name')).toBe('repo_name')
    expect(extractName('repo---name')).toBe('repo_name')
    expect(extractName('repo___name')).toBe('repo_name')
    expect(extractName('repo.-_name')).toBe('repo_name')
  })

  it('should remove leading special characters', () => {
    expect(extractName('...repo')).toBe('repo')
    expect(extractName('---repo')).toBe('repo')
    expect(extractName('___repo')).toBe('repo')
    expect(extractName('.-_repo')).toBe('repo')
  })

  it('should remove trailing special characters', () => {
    expect(extractName('repo...')).toBe('repo')
    expect(extractName('repo---')).toBe('repo')
    expect(extractName('repo___')).toBe('repo')
    expect(extractName('repo.-_')).toBe('repo')
  })

  it('should truncate names longer than 100 characters', () => {
    const longName = 'a'.repeat(150)
    expect(extractName(longName)).toBe('a'.repeat(100))
  })

  it('should handle combined transformations', () => {
    expect(extractName('---repo@#$name...')).toBe('repo_name')
    expect(extractName('  ...my/repo\\name___  ')).toBe('my_repo_name')
  })

  it('should return default repository name for empty or invalid inputs', () => {
    expect(extractName('')).toBe(constants.SOCKET_DEFAULT_REPOSITORY)
    expect(extractName('...')).toBe(constants.SOCKET_DEFAULT_REPOSITORY)
    expect(extractName('___')).toBe(constants.SOCKET_DEFAULT_REPOSITORY)
    expect(extractName('---')).toBe(constants.SOCKET_DEFAULT_REPOSITORY)
    expect(extractName('@#$%')).toBe(constants.SOCKET_DEFAULT_REPOSITORY)
  })
})

describe('extractOwner', () => {
  it('should return valid owner names unchanged', () => {
    expect(extractOwner('myowner')).toBe('myowner')
    expect(extractOwner('My-Owner_123')).toBe('My-Owner_123')
    expect(extractOwner('owner.with.dots')).toBe('owner.with.dots')
    expect(extractOwner('a1b2c3')).toBe('a1b2c3')
  })

  it('should replace sequences of illegal characters with underscore', () => {
    expect(extractOwner('owner@#$%name')).toBe('owner_name')
    expect(extractOwner('owner   name')).toBe('owner_name')
    expect(extractOwner('owner!!!name')).toBe('owner_name')
    expect(extractOwner('owner/\\|name')).toBe('owner_name')
  })

  it('should replace sequences of multiple allowed special chars with single underscore', () => {
    expect(extractOwner('owner...name')).toBe('owner_name')
    expect(extractOwner('owner---name')).toBe('owner_name')
    expect(extractOwner('owner___name')).toBe('owner_name')
    expect(extractOwner('owner.-_name')).toBe('owner_name')
  })

  it('should remove leading special characters', () => {
    expect(extractOwner('...owner')).toBe('owner')
    expect(extractOwner('---owner')).toBe('owner')
    expect(extractOwner('___owner')).toBe('owner')
    expect(extractOwner('.-_owner')).toBe('owner')
  })

  it('should remove trailing special characters', () => {
    expect(extractOwner('owner...')).toBe('owner')
    expect(extractOwner('owner---')).toBe('owner')
    expect(extractOwner('owner___')).toBe('owner')
    expect(extractOwner('owner.-_')).toBe('owner')
  })

  it('should truncate names longer than 100 characters', () => {
    const longName = 'a'.repeat(150)
    expect(extractOwner(longName)).toBe('a'.repeat(100))
  })

  it('should handle combined transformations', () => {
    expect(extractOwner('---owner@#$name...')).toBe('owner_name')
    expect(extractOwner('  ...my/owner\\name___  ')).toBe('my_owner_name')
  })

  it('should return undefined for empty or invalid inputs', () => {
    expect(extractOwner('')).toBeUndefined()
    expect(extractOwner('...')).toBeUndefined()
    expect(extractOwner('___')).toBeUndefined()
    expect(extractOwner('---')).toBeUndefined()
    expect(extractOwner('@#$%')).toBeUndefined()
  })

  it('should handle edge cases with mixed valid and invalid characters', () => {
    expect(extractOwner('a@b#c$d')).toBe('a_b_c_d')
    expect(extractOwner('123...456')).toBe('123_456')
    expect(extractOwner('---a---')).toBe('a')
  })
})
