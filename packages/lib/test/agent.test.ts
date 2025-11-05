/**
 * @fileoverview Comprehensive tests for package manager agent execution utilities.
 *
 * Tests package manager execution wrappers:
 * - execNpm(), execPnpm(), execYarn() execute package manager commands
 * - execScript() runs package.json scripts via appropriate PM
 * - Flag detection: isNpm*Flag() functions for npm-specific flags
 * - Audit, fund, loglevel, node-options, progress flag helpers
 * - Cross-platform package manager command execution
 * Used by Socket CLI for package manager operations with flag filtering.
 */

import {
  execNpm,
  execPnpm,
  execScript,
  execYarn,
  isNpmAuditFlag,
  isNpmFundFlag,
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
  isPnpmFrozenLockfileFlag,
  isPnpmIgnoreScriptsFlag,
  isPnpmInstallCommand,
  isPnpmLoglevelFlag,
} from '@socketsecurity/lib/agent'
import { describe, expect, it } from 'vitest'

describe('agent', () => {
  describe('Flag checking functions', () => {
    describe('isNpmAuditFlag', () => {
      it('should return true for --audit', () => {
        expect(isNpmAuditFlag('--audit')).toBe(true)
      })

      it('should return true for --no-audit', () => {
        expect(isNpmAuditFlag('--no-audit')).toBe(true)
      })

      it('should return true for --audit=false', () => {
        expect(isNpmAuditFlag('--audit=false')).toBe(true)
      })

      it('should return true for --audit=true', () => {
        expect(isNpmAuditFlag('--audit=true')).toBe(true)
      })

      it('should return true for --no-audit=anything', () => {
        expect(isNpmAuditFlag('--no-audit=value')).toBe(true)
      })

      it('should return false for --auditor', () => {
        expect(isNpmAuditFlag('--auditor')).toBe(false)
      })

      it('should return false for audit without dashes', () => {
        expect(isNpmAuditFlag('audit')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isNpmAuditFlag('')).toBe(false)
      })

      it('should return false for --audit-log', () => {
        expect(isNpmAuditFlag('--audit-log')).toBe(false)
      })

      it('should handle --audit with various values', () => {
        expect(isNpmAuditFlag('--audit=')).toBe(true)
        expect(isNpmAuditFlag('--audit=1')).toBe(true)
        expect(isNpmAuditFlag('--audit=0')).toBe(true)
        expect(isNpmAuditFlag('--no-audit=false')).toBe(true)
      })

      it('should not match partial strings', () => {
        expect(isNpmAuditFlag('--pre-audit')).toBe(false)
        expect(isNpmAuditFlag('--audit-level')).toBe(false)
      })
    })

    describe('isNpmFundFlag', () => {
      it('should return true for --fund', () => {
        expect(isNpmFundFlag('--fund')).toBe(true)
      })

      it('should return true for --no-fund', () => {
        expect(isNpmFundFlag('--no-fund')).toBe(true)
      })

      it('should return true for --fund=false', () => {
        expect(isNpmFundFlag('--fund=false')).toBe(true)
      })

      it('should return true for --fund=true', () => {
        expect(isNpmFundFlag('--fund=true')).toBe(true)
      })

      it('should return true for --no-fund=value', () => {
        expect(isNpmFundFlag('--no-fund=value')).toBe(true)
      })

      it('should return false for --funding', () => {
        expect(isNpmFundFlag('--funding')).toBe(false)
      })

      it('should return false for fund without dashes', () => {
        expect(isNpmFundFlag('fund')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isNpmFundFlag('')).toBe(false)
      })

      it('should return false for --funded', () => {
        expect(isNpmFundFlag('--funded')).toBe(false)
      })

      it('should handle --fund with various values', () => {
        expect(isNpmFundFlag('--fund=')).toBe(true)
        expect(isNpmFundFlag('--fund=1')).toBe(true)
        expect(isNpmFundFlag('--fund=0')).toBe(true)
        expect(isNpmFundFlag('--no-fund=false')).toBe(true)
      })

      it('should not match partial strings', () => {
        expect(isNpmFundFlag('--pre-fund')).toBe(false)
        expect(isNpmFundFlag('--fund-url')).toBe(false)
      })
    })

    describe('isNpmProgressFlag', () => {
      it('should return true for --progress', () => {
        expect(isNpmProgressFlag('--progress')).toBe(true)
      })

      it('should return true for --no-progress', () => {
        expect(isNpmProgressFlag('--no-progress')).toBe(true)
      })

      it('should return true for --progress=false', () => {
        expect(isNpmProgressFlag('--progress=false')).toBe(true)
      })

      it('should return true for --progress=true', () => {
        expect(isNpmProgressFlag('--progress=true')).toBe(true)
      })

      it('should return true for --no-progress=value', () => {
        expect(isNpmProgressFlag('--no-progress=value')).toBe(true)
      })

      it('should return false for --progressive', () => {
        expect(isNpmProgressFlag('--progressive')).toBe(false)
      })

      it('should return false for progress without dashes', () => {
        expect(isNpmProgressFlag('progress')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isNpmProgressFlag('')).toBe(false)
      })

      it('should return false for --progress-bar', () => {
        expect(isNpmProgressFlag('--progress-bar')).toBe(false)
      })

      it('should handle --progress with various values', () => {
        expect(isNpmProgressFlag('--progress=')).toBe(true)
        expect(isNpmProgressFlag('--progress=1')).toBe(true)
        expect(isNpmProgressFlag('--progress=0')).toBe(true)
        expect(isNpmProgressFlag('--no-progress=false')).toBe(true)
      })

      it('should not match partial strings', () => {
        expect(isNpmProgressFlag('--pre-progress')).toBe(false)
        expect(isNpmProgressFlag('--progress-enabled')).toBe(false)
      })
    })

    describe('isNpmLoglevelFlag', () => {
      it('should return true for --loglevel', () => {
        expect(isNpmLoglevelFlag('--loglevel')).toBe(true)
      })

      it('should return true for --loglevel=error', () => {
        expect(isNpmLoglevelFlag('--loglevel=error')).toBe(true)
      })

      it('should return true for --loglevel=warn', () => {
        expect(isNpmLoglevelFlag('--loglevel=warn')).toBe(true)
      })

      it('should return true for --silent', () => {
        expect(isNpmLoglevelFlag('--silent')).toBe(true)
      })

      it('should return true for --verbose', () => {
        expect(isNpmLoglevelFlag('--verbose')).toBe(true)
      })

      it('should return true for --info', () => {
        expect(isNpmLoglevelFlag('--info')).toBe(true)
      })

      it('should return true for --warn', () => {
        expect(isNpmLoglevelFlag('--warn')).toBe(true)
      })

      it('should return true for --error', () => {
        expect(isNpmLoglevelFlag('--error')).toBe(true)
      })

      it('should return true for --quiet', () => {
        expect(isNpmLoglevelFlag('--quiet')).toBe(true)
      })

      it('should return true for -s', () => {
        expect(isNpmLoglevelFlag('-s')).toBe(true)
      })

      it('should return true for -q', () => {
        expect(isNpmLoglevelFlag('-q')).toBe(true)
      })

      it('should return true for -d', () => {
        expect(isNpmLoglevelFlag('-d')).toBe(true)
      })

      it('should return true for -dd', () => {
        expect(isNpmLoglevelFlag('-dd')).toBe(true)
      })

      it('should return true for -ddd', () => {
        expect(isNpmLoglevelFlag('-ddd')).toBe(true)
      })

      it('should return true for -v', () => {
        expect(isNpmLoglevelFlag('-v')).toBe(true)
      })

      it('should return false for --loglevel-custom', () => {
        expect(isNpmLoglevelFlag('--loglevel-custom')).toBe(false)
      })

      it('should return false for -dddd', () => {
        expect(isNpmLoglevelFlag('-dddd')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isNpmLoglevelFlag('')).toBe(false)
      })

      it('should return false for --log', () => {
        expect(isNpmLoglevelFlag('--log')).toBe(false)
      })

      it('should return false for -x', () => {
        expect(isNpmLoglevelFlag('-x')).toBe(false)
      })

      it('should return false for -vv', () => {
        expect(isNpmLoglevelFlag('-vv')).toBe(false)
      })

      it('should handle --loglevel with various values', () => {
        expect(isNpmLoglevelFlag('--loglevel=')).toBe(true)
        expect(isNpmLoglevelFlag('--loglevel=silly')).toBe(true)
        expect(isNpmLoglevelFlag('--loglevel=http')).toBe(true)
        expect(isNpmLoglevelFlag('--loglevel=timing')).toBe(true)
      })

      it('should not match invalid short flags', () => {
        expect(isNpmLoglevelFlag('-a')).toBe(false)
        expect(isNpmLoglevelFlag('-b')).toBe(false)
        expect(isNpmLoglevelFlag('-x')).toBe(false)
      })

      it('should test all npm loglevel flag variations', () => {
        // Test all documented npm loglevel flags
        const validFlags = [
          '--loglevel',
          '--loglevel=error',
          '--silent',
          '--verbose',
          '--info',
          '--warn',
          '--error',
          '--quiet',
          '-s',
          '-q',
          '-d',
          '-dd',
          '-ddd',
          '-v',
        ]

        for (const flag of validFlags) {
          expect(isNpmLoglevelFlag(flag)).toBe(true)
        }
      })

      it('should reject invalid npm loglevel flag variations', () => {
        const invalidFlags = [
          '--loglevel-error',
          '--log',
          '--level',
          '-dddd',
          '-sss',
          '-qq',
          '-vv',
          '--silentt',
          '--verbosee',
        ]

        for (const flag of invalidFlags) {
          expect(isNpmLoglevelFlag(flag)).toBe(false)
        }
      })
    })

    describe('isNpmNodeOptionsFlag', () => {
      it('should return true for --node-options', () => {
        expect(isNpmNodeOptionsFlag('--node-options')).toBe(true)
      })

      it('should return true for --node-options=--max-old-space-size=4096', () => {
        expect(
          isNpmNodeOptionsFlag('--node-options=--max-old-space-size=4096'),
        ).toBe(true)
      })

      it('should return true for --node-options=""', () => {
        expect(isNpmNodeOptionsFlag('--node-options=""')).toBe(true)
      })

      it('should return false for --node-option', () => {
        expect(isNpmNodeOptionsFlag('--node-option')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isNpmNodeOptionsFlag('')).toBe(false)
      })

      it('should return false for --node', () => {
        expect(isNpmNodeOptionsFlag('--node')).toBe(false)
      })

      it('should handle --node-options with various values', () => {
        expect(isNpmNodeOptionsFlag('--node-options=')).toBe(true)
        expect(isNpmNodeOptionsFlag('--node-options=--inspect')).toBe(true)
        expect(
          isNpmNodeOptionsFlag('--node-options="--max-old-space-size=8192"'),
        ).toBe(true)
      })

      it('should not match partial strings', () => {
        expect(isNpmNodeOptionsFlag('--node')).toBe(false)
        expect(isNpmNodeOptionsFlag('--node-option')).toBe(false)
        expect(isNpmNodeOptionsFlag('--node-opts')).toBe(false)
      })

      it('should handle flags with spaces in values', () => {
        expect(isNpmNodeOptionsFlag('--node-options=--flag value')).toBe(true)
      })

      it('should handle flags with quotes', () => {
        expect(isNpmNodeOptionsFlag('--node-options="value"')).toBe(true)
        expect(isNpmNodeOptionsFlag("--node-options='value'")).toBe(true)
      })
    })

    describe('isPnpmIgnoreScriptsFlag', () => {
      it('should return true for --ignore-scripts', () => {
        expect(isPnpmIgnoreScriptsFlag('--ignore-scripts')).toBe(true)
      })

      it('should return true for --no-ignore-scripts', () => {
        expect(isPnpmIgnoreScriptsFlag('--no-ignore-scripts')).toBe(true)
      })

      it('should return false for --ignore-scripts=true', () => {
        expect(isPnpmIgnoreScriptsFlag('--ignore-scripts=true')).toBe(false)
      })

      it('should return false for --ignore-script', () => {
        expect(isPnpmIgnoreScriptsFlag('--ignore-script')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isPnpmIgnoreScriptsFlag('')).toBe(false)
      })

      it('should return false for --ignore', () => {
        expect(isPnpmIgnoreScriptsFlag('--ignore')).toBe(false)
      })
    })

    describe('isPnpmFrozenLockfileFlag', () => {
      it('should return true for --frozen-lockfile', () => {
        expect(isPnpmFrozenLockfileFlag('--frozen-lockfile')).toBe(true)
      })

      it('should return true for --no-frozen-lockfile', () => {
        expect(isPnpmFrozenLockfileFlag('--no-frozen-lockfile')).toBe(true)
      })

      it('should return false for --frozen-lockfile=true', () => {
        expect(isPnpmFrozenLockfileFlag('--frozen-lockfile=true')).toBe(false)
      })

      it('should return false for --frozen', () => {
        expect(isPnpmFrozenLockfileFlag('--frozen')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isPnpmFrozenLockfileFlag('')).toBe(false)
      })

      it('should return false for --lockfile', () => {
        expect(isPnpmFrozenLockfileFlag('--lockfile')).toBe(false)
      })
    })

    describe('isPnpmInstallCommand', () => {
      it('should return true for install', () => {
        expect(isPnpmInstallCommand('install')).toBe(true)
      })

      it('should return true for i', () => {
        expect(isPnpmInstallCommand('i')).toBe(true)
      })

      it('should return false for add', () => {
        expect(isPnpmInstallCommand('add')).toBe(false)
      })

      it('should return false for update', () => {
        expect(isPnpmInstallCommand('update')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isPnpmInstallCommand('')).toBe(false)
      })

      it('should return false for Install (capital)', () => {
        expect(isPnpmInstallCommand('Install')).toBe(false)
      })

      it('should return false for I (capital)', () => {
        expect(isPnpmInstallCommand('I')).toBe(false)
      })
    })

    describe('isPnpmLoglevelFlag', () => {
      it('should be an alias for isNpmLoglevelFlag', () => {
        expect(isPnpmLoglevelFlag).toBe(isNpmLoglevelFlag)
      })

      it('should return true for --loglevel', () => {
        expect(isPnpmLoglevelFlag('--loglevel')).toBe(true)
      })

      it('should return true for --silent', () => {
        expect(isPnpmLoglevelFlag('--silent')).toBe(true)
      })

      it('should return true for -d', () => {
        expect(isPnpmLoglevelFlag('-d')).toBe(true)
      })
    })
  })

  describe('Integration tests (using real spawn)', () => {
    // These tests verify the actual behavior without mocking
    // We can't easily test the full execution without running actual commands
    // so we focus on what we can test: the flag detection integration

    describe('execNpm argument transformation', () => {
      it('should have a function that returns a promise', () => {
        const result = execNpm(['--version'])
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should be a function', () => {
        expect(typeof execNpm).toBe('function')
      })
    })

    describe('execPnpm argument transformation', () => {
      it('should have a function that returns a promise', () => {
        const result = execPnpm(['--version'])
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should be a function', () => {
        expect(typeof execPnpm).toBe('function')
      })
    })

    describe('execYarn argument transformation', () => {
      it('should have a function that returns a promise', () => {
        const result = execYarn(['--version'])
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should be a function', () => {
        expect(typeof execYarn).toBe('function')
      })
    })

    describe('execScript argument transformation', () => {
      it('should have a function that returns a promise', () => {
        const result = execScript('test')
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should be a function', () => {
        expect(typeof execScript).toBe('function')
      })

      it('should handle script name with array args', () => {
        const result = execScript('test', ['--coverage'])
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should handle script name with options object', () => {
        const result = execScript('test', { cwd: process.cwd() })
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })

      it('should handle script name with args and options', () => {
        const result = execScript('test', ['--coverage'], {
          cwd: process.cwd(),
        })
        // Catch promise immediately to prevent unhandled rejection on Windows.
        result.catch(() => {})
        expect(result).toBeInstanceOf(Promise)
      })
    })
  })

  describe('Edge cases for flag detection', () => {
    describe('Case sensitivity', () => {
      it('should be case sensitive for long flags', () => {
        expect(isNpmAuditFlag('--AUDIT')).toBe(false)
        expect(isNpmFundFlag('--FUND')).toBe(false)
        expect(isNpmProgressFlag('--PROGRESS')).toBe(false)
      })

      it('should be case sensitive for short flags', () => {
        expect(isNpmLoglevelFlag('-S')).toBe(false)
        expect(isNpmLoglevelFlag('-Q')).toBe(false)
        expect(isNpmLoglevelFlag('-D')).toBe(false)
        expect(isNpmLoglevelFlag('-V')).toBe(false)
      })

      it('should be case sensitive for commands', () => {
        expect(isPnpmInstallCommand('INSTALL')).toBe(false)
        expect(isPnpmInstallCommand('Install')).toBe(false)
        expect(isPnpmInstallCommand('I')).toBe(false)
      })
    })

    describe('Boundary conditions', () => {
      it('should handle single character inputs', () => {
        expect(isNpmAuditFlag('-')).toBe(false)
        expect(isNpmFundFlag('f')).toBe(false)
        expect(isNpmProgressFlag('p')).toBe(false)
      })

      it('should handle very long inputs', () => {
        const longFlag = `--audit=${'a'.repeat(1000)}`
        expect(isNpmAuditFlag(longFlag)).toBe(true)
      })

      it('should handle unicode characters', () => {
        expect(isNpmAuditFlag('--audit=🚀')).toBe(true)
        expect(isNpmFundFlag('--fund=测试')).toBe(true)
      })
    })

    describe('Whitespace handling', () => {
      it('should not match flags with leading whitespace', () => {
        expect(isNpmAuditFlag(' --audit')).toBe(false)
        expect(isNpmFundFlag('  --fund')).toBe(false)
      })

      it('should not match flags with trailing whitespace', () => {
        expect(isNpmAuditFlag('--audit ')).toBe(false)
        expect(isNpmFundFlag('--fund  ')).toBe(false)
      })

      it('should not match flags with internal whitespace', () => {
        expect(isNpmAuditFlag('-- audit')).toBe(false)
        expect(isNpmFundFlag('--no -fund')).toBe(false)
      })
    })

    describe('Special characters', () => {
      it('should handle flags with multiple equals signs', () => {
        expect(isNpmAuditFlag('--audit=key=value')).toBe(true)
        expect(isNpmFundFlag('--fund=url=https://example.com')).toBe(true)
      })

      it('should handle flags with special characters in values', () => {
        expect(isNpmLoglevelFlag('--loglevel=some value')).toBe(true)
        expect(isNpmProgressFlag('--progress=@#$%')).toBe(true)
      })
    })
  })
})
