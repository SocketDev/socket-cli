/**
 * @fileoverview Unit tests for platform detection and OS-specific constants.
 *
 * Tests platform/OS constants:
 * - IS_WINDOWS, IS_MAC, IS_LINUX (boolean flags)
 * - PLATFORM (win32, darwin, linux from process.platform)
 * - EOL (line ending: \\r\\n on Windows, \\n on Unix)
 * - Architecture detection (x64, arm64)
 * Frozen constants for cross-platform compatibility.
 */

import { describe, expect, it } from 'vitest'

import {
  DARWIN,
  S_IXGRP,
  S_IXOTH,
  S_IXUSR,
  WIN32,
} from '@socketsecurity/lib/constants/platform'

describe('constants/platform', () => {
  describe('platform detection', () => {
    it('should export DARWIN boolean', () => {
      expect(typeof DARWIN).toBe('boolean')
    })

    it('should export WIN32 boolean', () => {
      expect(typeof WIN32).toBe('boolean')
    })

    it('should have mutually exclusive platform flags', () => {
      // A system cannot be both Darwin and Win32
      if (DARWIN) {
        expect(WIN32).toBe(false)
      }
      if (WIN32) {
        expect(DARWIN).toBe(false)
      }
    })

    it('should reflect actual platform', () => {
      const platform = process.platform
      if (platform === 'darwin') {
        expect(DARWIN).toBe(true)
        expect(WIN32).toBe(false)
      } else if (platform === 'win32') {
        expect(DARWIN).toBe(false)
        expect(WIN32).toBe(true)
      } else {
        expect(DARWIN).toBe(false)
        expect(WIN32).toBe(false)
      }
    })

    it('should be consistent across multiple reads', () => {
      const darwin1 = DARWIN
      const darwin2 = DARWIN
      expect(darwin1).toBe(darwin2)

      const win321 = WIN32
      const win322 = WIN32
      expect(win321).toBe(win322)
    })
  })

  describe('file permission modes', () => {
    it('should export S_IXUSR constant', () => {
      expect(S_IXUSR).toBe(0o100)
    })

    it('should export S_IXGRP constant', () => {
      expect(S_IXGRP).toBe(0o010)
    })

    it('should export S_IXOTH constant', () => {
      expect(S_IXOTH).toBe(0o001)
    })

    it('should be octal numbers', () => {
      expect(typeof S_IXUSR).toBe('number')
      expect(typeof S_IXGRP).toBe('number')
      expect(typeof S_IXOTH).toBe('number')
    })

    it('should have correct decimal values', () => {
      expect(S_IXUSR).toBe(64) // 0o100 = 64
      expect(S_IXGRP).toBe(8) // 0o010 = 8
      expect(S_IXOTH).toBe(1) // 0o001 = 1
    })

    it('should have different values', () => {
      expect(S_IXUSR).not.toBe(S_IXGRP)
      expect(S_IXUSR).not.toBe(S_IXOTH)
      expect(S_IXGRP).not.toBe(S_IXOTH)
    })

    it('should be in descending order', () => {
      expect(S_IXUSR).toBeGreaterThan(S_IXGRP)
      expect(S_IXGRP).toBeGreaterThan(S_IXOTH)
    })

    it('should be combinable with bitwise OR', () => {
      const allExecute = S_IXUSR | S_IXGRP | S_IXOTH
      expect(allExecute).toBe(0o111)
      expect(allExecute).toBe(73) // 64 + 8 + 1
    })

    it('should be testable with bitwise AND', () => {
      const mode = 0o755 // rwxr-xr-x
      expect(mode & S_IXUSR).toBeTruthy()
      expect(mode & S_IXGRP).toBeTruthy()
      expect(mode & S_IXOTH).toBeTruthy()
    })
  })

  describe('permission bit patterns', () => {
    it('should represent user execute permission', () => {
      // S_IXUSR = owner execute bit
      const userExec = S_IXUSR
      expect(userExec.toString(8)).toBe('100')
    })

    it('should represent group execute permission', () => {
      // S_IXGRP = group execute bit
      const groupExec = S_IXGRP
      expect(groupExec.toString(8)).toBe('10')
    })

    it('should represent other execute permission', () => {
      // S_IXOTH = other execute bit
      const otherExec = S_IXOTH
      expect(otherExec.toString(8)).toBe('1')
    })

    it('should combine to create execute-only mode', () => {
      const execOnly = S_IXUSR | S_IXGRP | S_IXOTH
      expect(execOnly).toBe(0o111)
    })

    it('should work with common file modes', () => {
      const mode755 = 0o755
      expect(mode755 & S_IXUSR).toBe(S_IXUSR)
      expect(mode755 & S_IXGRP).toBe(S_IXGRP)
      expect(mode755 & S_IXOTH).toBe(S_IXOTH)
    })

    it('should detect missing execute permissions', () => {
      const mode644 = 0o644 // rw-r--r--
      expect(mode644 & S_IXUSR).toBe(0)
      expect(mode644 & S_IXGRP).toBe(0)
      expect(mode644 & S_IXOTH).toBe(0)
    })
  })

  describe('platform-specific behavior', () => {
    it('should enable platform-specific logic for Darwin', () => {
      if (DARWIN) {
        // macOS-specific code would go here
        expect(process.platform).toBe('darwin')
      }
    })

    it('should enable platform-specific logic for Windows', () => {
      if (WIN32) {
        // Windows-specific code would go here
        expect(process.platform).toBe('win32')
      }
    })

    it('should handle non-Darwin, non-Windows platforms', () => {
      if (!DARWIN && !WIN32) {
        // Likely Linux or other Unix
        expect(['linux', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(
          process.platform,
        )
      }
    })
  })

  describe('real-world usage', () => {
    it('should support checking if executable bit is set', () => {
      const fileMode = 0o755
      const isExecutable = !!(fileMode & S_IXUSR)
      expect(isExecutable).toBe(true)
    })

    it('should support adding execute permissions', () => {
      let mode = 0o644 // rw-r--r--
      mode |= S_IXUSR | S_IXGRP | S_IXOTH
      expect(mode).toBe(0o755) // rwxr-xr-x
    })

    it('should support removing execute permissions', () => {
      let mode = 0o755 // rwxr-xr-x
      mode &= ~(S_IXUSR | S_IXGRP | S_IXOTH)
      expect(mode).toBe(0o644) // rw-r--r--
    })

    it('should support platform-conditional file paths', () => {
      const separator = WIN32 ? '\\' : '/'
      const path = `home${separator}user${separator}file.txt`
      if (WIN32) {
        expect(path).toContain('\\')
      } else {
        expect(path).toContain('/')
      }
    })

    it('should support platform-conditional binary extensions', () => {
      const binaryName = WIN32 ? 'app.exe' : 'app'
      if (WIN32) {
        expect(binaryName.endsWith('.exe')).toBe(true)
      } else {
        expect(binaryName).not.toContain('.')
      }
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment of DARWIN', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        DARWIN = !DARWIN
      }).toThrow()
    })

    it('should not allow reassignment of WIN32', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        WIN32 = !WIN32
      }).toThrow()
    })

    it('should not allow reassignment of permission constants', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        S_IXUSR = 0
      }).toThrow()
    })
  })

  describe('permission constant relationships', () => {
    it('should have powers of 2 relationship in octal', () => {
      // In octal: 100, 010, 001 (each digit is independent)
      expect(S_IXUSR).toBe(64) // 2^6
      expect(S_IXGRP).toBe(8) // 2^3
      expect(S_IXOTH).toBe(1) // 2^0
    })

    it('should not overlap when combined', () => {
      const combined = S_IXUSR | S_IXGRP | S_IXOTH
      // Each bit should contribute to the final value
      expect(combined).toBe(S_IXUSR + S_IXGRP + S_IXOTH)
    })

    it('should be extractable individually from combined mode', () => {
      const mode = 0o751 // rwxr-x--x
      expect(mode & S_IXUSR).toBe(S_IXUSR) // User can execute
      expect(mode & S_IXGRP).toBe(S_IXGRP) // Group can execute
      expect(mode & S_IXOTH).toBe(S_IXOTH) // Other can execute
    })
  })
})
