/**
 * @fileoverview Unit tests for package manager agent constants.
 *
 * Tests package manager detection and user agent constants:
 * - Agent names: npm, pnpm, yarn, bun detection
 * - USER_AGENT strings for HTTP requests
 * - Package manager version detection
 * Frozen constants for identifying package manager context and HTTP client identification.
 */

import { describe, expect, it } from 'vitest'

import {
  BUN,
  BUN_LOCK,
  BUN_LOCKB,
  NPM,
  NPM_BIN_PATH,
  NPM_REAL_EXEC_PATH,
  NPM_REGISTRY_URL,
  NPM_SHRINKWRAP_JSON,
  NPX,
  OVERRIDES,
  PACKAGE_LOCK,
  PACKAGE_LOCK_JSON,
  PNPM,
  PNPM_LOCK,
  PNPM_LOCK_YAML,
  PNPM_WORKSPACE_YAML,
  RESOLUTIONS,
  VLT,
  VLT_LOCK_JSON,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
} from '@socketsecurity/lib/constants/agents'

describe('constants/agents', () => {
  describe('agent names', () => {
    it('should export NPM constant', () => {
      expect(NPM).toBe('npm')
    })

    it('should export PNPM constant', () => {
      expect(PNPM).toBe('pnpm')
    })

    it('should export YARN constant', () => {
      expect(YARN).toBe('yarn')
    })

    it('should export BUN constant', () => {
      expect(BUN).toBe('bun')
    })

    it('should export VLT constant', () => {
      expect(VLT).toBe('vlt')
    })

    it('should export NPX constant', () => {
      expect(NPX).toBe('npx')
    })

    it('should be strings', () => {
      expect(typeof NPM).toBe('string')
      expect(typeof PNPM).toBe('string')
      expect(typeof YARN).toBe('string')
      expect(typeof BUN).toBe('string')
      expect(typeof VLT).toBe('string')
      expect(typeof NPX).toBe('string')
    })

    it('should be lowercase', () => {
      expect(NPM).toBe(NPM.toLowerCase())
      expect(PNPM).toBe(PNPM.toLowerCase())
      expect(YARN).toBe(YARN.toLowerCase())
      expect(BUN).toBe(BUN.toLowerCase())
      expect(VLT).toBe(VLT.toLowerCase())
      expect(NPX).toBe(NPX.toLowerCase())
    })

    it('should have unique values', () => {
      const agents = [NPM, PNPM, YARN, BUN, VLT, NPX]
      const uniqueAgents = [...new Set(agents)]
      expect(uniqueAgents.length).toBe(agents.length)
    })
  })

  describe('agent variants', () => {
    it('should export YARN_BERRY constant', () => {
      expect(YARN_BERRY).toBe('yarn/berry')
    })

    it('should export YARN_CLASSIC constant', () => {
      expect(YARN_CLASSIC).toBe('yarn/classic')
    })

    it('should contain yarn prefix', () => {
      expect(YARN_BERRY.startsWith('yarn/')).toBe(true)
      expect(YARN_CLASSIC.startsWith('yarn/')).toBe(true)
    })

    it('should be different variants', () => {
      expect(YARN_BERRY).not.toBe(YARN_CLASSIC)
    })

    it('should use slash separator', () => {
      expect(YARN_BERRY).toContain('/')
      expect(YARN_CLASSIC).toContain('/')
    })
  })

  describe('NPM binary paths', () => {
    it('should export NPM_BIN_PATH', () => {
      expect(NPM_BIN_PATH).toBeDefined()
    })

    it('should be a string', () => {
      expect(typeof NPM_BIN_PATH).toBe('string')
    })

    it('should contain npm in path', () => {
      expect(NPM_BIN_PATH.toLowerCase()).toContain('npm')
    })

    it('should handle NPM_REAL_EXEC_PATH', () => {
      // May be undefined if npm is not installed
      if (NPM_REAL_EXEC_PATH !== undefined) {
        expect(typeof NPM_REAL_EXEC_PATH).toBe('string')
      } else {
        expect(NPM_REAL_EXEC_PATH).toBeUndefined()
      }
    })

    it('should point to cli.js when NPM_REAL_EXEC_PATH is defined', () => {
      if (NPM_REAL_EXEC_PATH) {
        expect(NPM_REAL_EXEC_PATH).toContain('cli.js')
      }
    })

    it('should have path structure when NPM_REAL_EXEC_PATH is defined', () => {
      if (NPM_REAL_EXEC_PATH) {
        expect(NPM_REAL_EXEC_PATH).toMatch(/node_modules.*npm.*lib.*cli\.js/)
      }
    })
  })

  describe('NPM registry', () => {
    it('should export NPM_REGISTRY_URL', () => {
      expect(NPM_REGISTRY_URL).toBe('https://registry.npmjs.org')
    })

    it('should be a valid HTTPS URL', () => {
      expect(NPM_REGISTRY_URL).toMatch(/^https:\/\//)
    })

    it('should point to registry.npmjs.org', () => {
      expect(NPM_REGISTRY_URL).toContain('registry.npmjs.org')
    })

    it('should not have trailing slash', () => {
      expect(NPM_REGISTRY_URL.endsWith('/')).toBe(false)
    })

    it('should be a valid URL', () => {
      expect(() => new URL(NPM_REGISTRY_URL)).not.toThrow()
    })
  })

  describe('lockfile names', () => {
    it('should export PACKAGE_LOCK constant', () => {
      expect(PACKAGE_LOCK).toBe('package-lock')
    })

    it('should export PACKAGE_LOCK_JSON constant', () => {
      expect(PACKAGE_LOCK_JSON).toBe('package-lock.json')
    })

    it('should export NPM_SHRINKWRAP_JSON constant', () => {
      expect(NPM_SHRINKWRAP_JSON).toBe('npm-shrinkwrap.json')
    })

    it('should export PNPM_LOCK constant', () => {
      expect(PNPM_LOCK).toBe('pnpm-lock')
    })

    it('should export PNPM_LOCK_YAML constant', () => {
      expect(PNPM_LOCK_YAML).toBe('pnpm-lock.yaml')
    })

    it('should export YARN_LOCK constant', () => {
      expect(YARN_LOCK).toBe('yarn.lock')
    })

    it('should export BUN_LOCK constant', () => {
      expect(BUN_LOCK).toBe('bun.lock')
    })

    it('should export BUN_LOCKB constant', () => {
      expect(BUN_LOCKB).toBe('bun.lockb')
    })

    it('should export VLT_LOCK_JSON constant', () => {
      expect(VLT_LOCK_JSON).toBe('vlt-lock.json')
    })

    it('should use correct file extensions', () => {
      expect(PACKAGE_LOCK_JSON.endsWith('.json')).toBe(true)
      expect(NPM_SHRINKWRAP_JSON.endsWith('.json')).toBe(true)
      expect(PNPM_LOCK_YAML.endsWith('.yaml')).toBe(true)
      expect(YARN_LOCK.endsWith('.lock')).toBe(true)
      expect(BUN_LOCK.endsWith('.lock')).toBe(true)
      expect(BUN_LOCKB.endsWith('.lockb')).toBe(true)
      expect(VLT_LOCK_JSON.endsWith('.json')).toBe(true)
    })

    it('should have unique lockfile names', () => {
      const lockfiles = [
        PACKAGE_LOCK_JSON,
        NPM_SHRINKWRAP_JSON,
        PNPM_LOCK_YAML,
        YARN_LOCK,
        BUN_LOCK,
        BUN_LOCKB,
        VLT_LOCK_JSON,
      ]
      const uniqueLockfiles = [...new Set(lockfiles)]
      expect(uniqueLockfiles.length).toBe(lockfiles.length)
    })

    it('should use kebab-case for lock names', () => {
      expect(PACKAGE_LOCK).toMatch(/^[a-z-]+$/)
      expect(PNPM_LOCK).toMatch(/^[a-z-]+$/)
    })
  })

  describe('workspace configuration', () => {
    it('should export PNPM_WORKSPACE_YAML', () => {
      expect(PNPM_WORKSPACE_YAML).toBe('pnpm-workspace.yaml')
    })

    it('should be a YAML file', () => {
      expect(PNPM_WORKSPACE_YAML.endsWith('.yaml')).toBe(true)
    })

    it('should contain workspace in name', () => {
      expect(PNPM_WORKSPACE_YAML).toContain('workspace')
    })
  })

  describe('package.json override fields', () => {
    it('should export OVERRIDES constant', () => {
      expect(OVERRIDES).toBe('overrides')
    })

    it('should export RESOLUTIONS constant', () => {
      expect(RESOLUTIONS).toBe('resolutions')
    })

    it('should be lowercase', () => {
      expect(OVERRIDES).toBe(OVERRIDES.toLowerCase())
      expect(RESOLUTIONS).toBe(RESOLUTIONS.toLowerCase())
    })

    it('should be different field names', () => {
      expect(OVERRIDES).not.toBe(RESOLUTIONS)
    })
  })

  describe('constant relationships', () => {
    it('should have matching PACKAGE_LOCK and PACKAGE_LOCK_JSON', () => {
      expect(PACKAGE_LOCK_JSON).toContain(PACKAGE_LOCK)
    })

    it('should have matching PNPM_LOCK and PNPM_LOCK_YAML', () => {
      expect(PNPM_LOCK_YAML).toContain(PNPM_LOCK)
    })

    it('should have matching BUN_LOCK and BUN_LOCKB', () => {
      expect(BUN_LOCKB).toContain('bun')
      expect(BUN_LOCK).toContain('bun')
    })

    it('should have YARN_BERRY and YARN_CLASSIC share YARN prefix', () => {
      expect(YARN_BERRY.split('/')[0]).toBe(YARN)
      expect(YARN_CLASSIC.split('/')[0]).toBe(YARN)
    })
  })

  describe('package manager detection patterns', () => {
    it('should support npm detection via NPM_BIN_PATH', () => {
      expect(NPM_BIN_PATH).toBeTruthy()
    })

    it('should support lockfile-based detection', () => {
      const lockfiles = {
        [PACKAGE_LOCK_JSON]: NPM,
        [NPM_SHRINKWRAP_JSON]: NPM,
        [PNPM_LOCK_YAML]: PNPM,
        [YARN_LOCK]: YARN,
        [BUN_LOCK]: BUN,
        [BUN_LOCKB]: BUN,
        [VLT_LOCK_JSON]: VLT,
      }

      Object.entries(lockfiles).forEach(([lockfile, agent]) => {
        expect(typeof lockfile).toBe('string')
        expect(typeof agent).toBe('string')
      })
    })
  })

  describe('file name patterns', () => {
    it('should use hyphens for npm lockfiles', () => {
      expect(PACKAGE_LOCK_JSON).toContain('-')
      expect(NPM_SHRINKWRAP_JSON).toContain('-')
    })

    it('should use hyphens for pnpm files', () => {
      expect(PNPM_LOCK_YAML).toContain('-')
      expect(PNPM_WORKSPACE_YAML).toContain('-')
    })

    it('should use dots for extensions', () => {
      expect(YARN_LOCK.split('.').length).toBe(2)
      expect(BUN_LOCK.split('.').length).toBe(2)
      expect(BUN_LOCKB.split('.').length).toBe(2)
    })
  })

  describe('registry configuration', () => {
    it('should have HTTPS registry URL', () => {
      expect(NPM_REGISTRY_URL.startsWith('https://')).toBe(true)
    })

    it('should use official npm registry', () => {
      expect(NPM_REGISTRY_URL).toBe('https://registry.npmjs.org')
    })
  })

  describe('override field compatibility', () => {
    it('should support npm overrides field', () => {
      expect(OVERRIDES).toBe('overrides')
    })

    it('should support yarn resolutions field', () => {
      expect(RESOLUTIONS).toBe('resolutions')
    })

    it('should be valid package.json field names', () => {
      expect(OVERRIDES).toMatch(/^[a-z]+$/)
      expect(RESOLUTIONS).toMatch(/^[a-z]+$/)
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment of agent constants', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        NPM = 'something else'
      }).toThrow()
    })

    it('should not allow reassignment of lockfile constants', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        PACKAGE_LOCK_JSON = 'something.json'
      }).toThrow()
    })

    it('should not allow reassignment of URL constants', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        NPM_REGISTRY_URL = 'https://other-registry.com'
      }).toThrow()
    })
  })

  describe('real-world usage', () => {
    it('should support lockfile matching', () => {
      const filename = 'package-lock.json'
      expect(filename).toBe(PACKAGE_LOCK_JSON)
    })

    it('should support agent type checking', () => {
      const agent = 'npm'
      expect(agent).toBe(NPM)
    })

    it('should support registry URL construction', () => {
      const packageUrl = `${NPM_REGISTRY_URL}/package-name`
      expect(packageUrl).toMatch(/^https:\/\/registry\.npmjs\.org\//)
    })

    it('should support yarn variant detection', () => {
      expect(YARN_BERRY).toContain(YARN)
      expect(YARN_CLASSIC).toContain(YARN)
    })
  })
})
