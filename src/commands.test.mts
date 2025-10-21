import { describe, expect, it } from 'vitest'

import { rootAliases, rootCommands } from './commands.mts'

describe('commands', () => {
  describe('rootCommands', () => {
    it('exports all expected root commands', () => {
      expect(rootCommands).toBeDefined()
      expect(typeof rootCommands).toBe('object')

      // Check for key commands.
      expect(rootCommands).toHaveProperty('analytics')
      expect(rootCommands).toHaveProperty('audit-log')
      expect(rootCommands).toHaveProperty('ci')
      expect(rootCommands).toHaveProperty('config')
      expect(rootCommands).toHaveProperty('fix')
      expect(rootCommands).toHaveProperty('install')
      expect(rootCommands).toHaveProperty('login')
      expect(rootCommands).toHaveProperty('logout')
      expect(rootCommands).toHaveProperty('npm')
      expect(rootCommands).toHaveProperty('npx')
      expect(rootCommands).toHaveProperty('optimize')
      expect(rootCommands).toHaveProperty('organization')
      expect(rootCommands).toHaveProperty('package')
      expect(rootCommands).toHaveProperty('patch')
      expect(rootCommands).toHaveProperty('pnpm')
      expect(rootCommands).toHaveProperty('scan')
      expect(rootCommands).toHaveProperty('yarn')
    })

    it('has command objects for all root commands', () => {
      for (const [, command] of Object.entries(rootCommands)) {
        expect(command).toBeDefined()
        expect(typeof command).toBe('object')
        // Commands have either a 'run' method or 'handler' method.
        expect(
          typeof command.run === 'function' ||
            typeof command.handler === 'function',
        ).toBe(true)
      }
    })

    it('has descriptions for all commands', () => {
      for (const [, command] of Object.entries(rootCommands)) {
        expect(command).toHaveProperty('description')
        expect(typeof command.description).toBe('string')
        expect(command.description.length).toBeGreaterThan(0)
      }
    })
  })

  describe('rootAliases', () => {
    it('exports command aliases', () => {
      expect(rootAliases).toBeDefined()
      expect(typeof rootAliases).toBe('object')
    })

    it('provides aliases for common commands', () => {
      // Check that some aliases exist.
      expect(rootAliases).toHaveProperty('audit')
      expect(rootAliases).toHaveProperty('deps')
      expect(rootAliases).toHaveProperty('feed')
      expect(rootAliases).toHaveProperty('org')
      expect(rootAliases).toHaveProperty('pkg')
    })

    it('all aliases have description and argv', () => {
      for (const [, alias] of Object.entries(rootAliases)) {
        expect(alias).toHaveProperty('description')
        expect(alias).toHaveProperty('argv')
        expect(Array.isArray(alias.argv)).toBe(true)
        expect(alias.argv.length).toBeGreaterThan(0)
      }
    })

    it('aliases point to valid root commands or subcommands', () => {
      for (const [, alias] of Object.entries(rootAliases)) {
        const targetCommand = alias.argv[0]
        // Check if the target exists in rootCommands or is a known subcommand.
        const isValidTarget =
          rootCommands[targetCommand] !== undefined ||
          targetCommand === 'dependencies' || // Points to organization dependencies.
          targetCommand === 'threat-feed' || // Special command.
          targetCommand === 'repos' // Repository alias.

        expect(isValidTarget).toBe(true)
      }
    })
  })

  describe('package manager commands', () => {
    it('includes all package managers', () => {
      const packageManagers = ['npm', 'npx', 'pnpm', 'yarn']

      for (const pm of packageManagers) {
        expect(rootCommands).toHaveProperty(pm)
        const command = rootCommands[pm]
        expect(
          typeof command.run === 'function' ||
            typeof command.handler === 'function',
        ).toBe(true)
      }
    })
  })

  describe('command structure', () => {
    it('all commands have consistent structure', () => {
      for (const [, command] of Object.entries(rootCommands)) {
        // Check for required properties.
        expect(command).toHaveProperty('description')

        // Commands have either run or handler.
        const hasRun = typeof command.run === 'function'
        const hasHandler = typeof command.handler === 'function'
        expect(hasRun || hasHandler).toBe(true)

        // Description should be a non-empty string.
        expect(typeof command.description).toBe('string')
        expect(command.description.length).toBeGreaterThan(0)
      }
    })
  })

  describe('special commands', () => {
    it('has wrapper command', () => {
      expect(rootCommands).toHaveProperty('wrapper')
    })

    it('has raw npm/npx commands', () => {
      expect(rootCommands).toHaveProperty('raw-npm')
      expect(rootCommands).toHaveProperty('raw-npx')
    })

    it('has organization management command', () => {
      expect(rootCommands).toHaveProperty('organization')
    })

    it('has repository management command', () => {
      expect(rootCommands).toHaveProperty('repository')
    })

    it('has security scanning command', () => {
      expect(rootCommands).toHaveProperty('scan')
      expect(rootCommands).toHaveProperty('audit-log')
    })

    it('has optimization commands', () => {
      expect(rootCommands).toHaveProperty('optimize')
      expect(rootCommands).toHaveProperty('fix')
      expect(rootCommands).toHaveProperty('patch')
    })
  })
})
