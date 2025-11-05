/**
 * @fileoverview Unit tests for Windows environment variable getters.
 *
 * Tests Windows-specific environment variable accessors:
 * - getUserprofile() - user profile directory (USERPROFILE, Windows equivalent of HOME)
 * - getAppdata() - application data directory (APPDATA)
 * - getLocalappdata() - local application data directory (LOCALAPPDATA)
 * - getComspec() - command interpreter path (COMSPEC, typically cmd.exe)
 * Uses rewire for test isolation. Critical for Windows path resolution and app storage.
 */

import {
  getAppdata,
  getComspec,
  getLocalappdata,
  getUserprofile,
} from '@socketsecurity/lib/env/windows'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('windows env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getAppdata', () => {
    it('should return APPDATA path when set', () => {
      setEnv('APPDATA', 'C:\\Users\\TestUser\\AppData\\Roaming')
      expect(getAppdata()).toBe('C:\\Users\\TestUser\\AppData\\Roaming')
    })

    it('should return undefined when not set', () => {
      setEnv('APPDATA', undefined)
      expect(getAppdata()).toBeUndefined()
    })
  })

  describe('getLocalappdata', () => {
    it('should return LOCALAPPDATA path when set', () => {
      setEnv('LOCALAPPDATA', 'C:\\Users\\TestUser\\AppData\\Local')
      expect(getLocalappdata()).toBe('C:\\Users\\TestUser\\AppData\\Local')
    })

    it('should return undefined when not set', () => {
      setEnv('LOCALAPPDATA', undefined)
      expect(getLocalappdata()).toBeUndefined()
    })
  })

  describe('getUserprofile', () => {
    it('should return USERPROFILE path when set', () => {
      setEnv('USERPROFILE', 'C:\\Users\\TestUser')
      expect(getUserprofile()).toBe('C:\\Users\\TestUser')
    })

    it('should return undefined when not set', () => {
      setEnv('USERPROFILE', undefined)
      expect(getUserprofile()).toBeUndefined()
    })
  })

  describe('getComspec', () => {
    it('should return COMSPEC path when set', () => {
      setEnv('COMSPEC', 'C:\\Windows\\System32\\cmd.exe')
      expect(getComspec()).toBe('C:\\Windows\\System32\\cmd.exe')
    })

    it('should return undefined when not set', () => {
      setEnv('COMSPEC', undefined)
      expect(getComspec()).toBeUndefined()
    })
  })
})
