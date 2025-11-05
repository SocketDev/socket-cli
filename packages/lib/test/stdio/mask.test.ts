/**
 * @fileoverview Unit tests for stdio output masking utilities.
 *
 * Tests CLI output masking for hiding/showing command output during execution:
 * - createOutputMask() creates mask objects with spinner and buffer control
 * - isSpinning flag indicates whether output should be masked (spinner active)
 * - verbose/showOutput modes to control visibility of underlying command output
 * - outputBuffer stores captured output for later replay
 * - stdoutCapture/stderrCapture track stream data during masking
 * Used by CLI tools to show spinners during long operations then replay output on errors.
 * NOT related to password masking - this is for CLI output visibility control.
 */

import {
  createOutputMask,
  type OutputMaskOptions,
  type OutputMask,
} from '@socketsecurity/lib/stdio/mask'
import { describe, expect, it } from 'vitest'

describe('stdio/mask', () => {
  describe('createOutputMask', () => {
    it('should create mask with default options', () => {
      const mask = createOutputMask()
      expect(mask).toBeDefined()
      expect(mask.isSpinning).toBe(true)
      expect(mask.outputBuffer).toEqual([])
      expect(mask.verbose).toBe(false)
      expect(mask.stdoutCapture).toBe('')
      expect(mask.stderrCapture).toBe('')
    })

    it('should create mask with showOutput true', () => {
      const mask = createOutputMask({ showOutput: true })
      expect(mask.isSpinning).toBe(false)
      expect(mask.verbose).toBe(true)
      expect(mask.outputBuffer).toEqual([])
    })

    it('should create mask with showOutput false', () => {
      const mask = createOutputMask({ showOutput: false })
      expect(mask.isSpinning).toBe(true)
      expect(mask.verbose).toBe(false)
    })

    it('should initialize empty output buffer', () => {
      const mask = createOutputMask()
      expect(Array.isArray(mask.outputBuffer)).toBe(true)
      expect(mask.outputBuffer.length).toBe(0)
    })

    it('should initialize empty capture strings', () => {
      const mask = createOutputMask()
      expect(mask.stdoutCapture).toBe('')
      expect(mask.stderrCapture).toBe('')
    })

    it('should handle empty options object', () => {
      const mask = createOutputMask({})
      expect(mask).toBeDefined()
      expect(mask.verbose).toBe(false)
    })

    it('should handle options with custom message', () => {
      const options: OutputMaskOptions = {
        message: 'Custom progress message',
        showOutput: false,
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
      expect(mask.isSpinning).toBe(true)
    })

    it('should handle options with toggle text', () => {
      const options: OutputMaskOptions = {
        toggleText: 'custom toggle text',
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
    })

    it('should handle options with filter function', () => {
      const filterFn = (text: string, _stream: 'stdout' | 'stderr') => {
        return !text.includes('ignore')
      }
      const options: OutputMaskOptions = {
        filterOutput: filterFn,
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
    })

    it('should handle options with override exit code function', () => {
      const overrideFn = (code: number, _stdout: string, stderr: string) => {
        if (code !== 0 && stderr.includes('non-fatal')) {
          return 0
        }
        return undefined
      }
      const options: OutputMaskOptions = {
        overrideExitCode: overrideFn,
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
    })

    it('should handle options with cwd', () => {
      const options: OutputMaskOptions = {
        cwd: '/custom/path',
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
    })

    it('should handle options with env', () => {
      const options: OutputMaskOptions = {
        env: { NODE_ENV: 'test', CUSTOM: 'value' },
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
    })

    it('should handle all options combined', () => {
      const options: OutputMaskOptions = {
        cwd: '/test',
        env: { TEST: '1' },
        filterOutput: text => !text.includes('skip'),
        message: 'Testing...',
        overrideExitCode: code => (code === 1 ? 0 : undefined),
        showOutput: true,
        toggleText: 'to toggle',
      }
      const mask = createOutputMask(options)
      expect(mask).toBeDefined()
      expect(mask.verbose).toBe(true)
      expect(mask.isSpinning).toBe(false)
    })
  })

  describe('OutputMask type', () => {
    it('should create valid OutputMask object', () => {
      const mask: OutputMask = {
        isSpinning: false,
        outputBuffer: ['line1', 'line2'],
        stderrCapture: 'stderr content',
        stdoutCapture: 'stdout content',
        verbose: true,
      }
      expect(mask.isSpinning).toBe(false)
      expect(mask.outputBuffer).toHaveLength(2)
      expect(mask.stderrCapture).toBe('stderr content')
      expect(mask.stdoutCapture).toBe('stdout content')
      expect(mask.verbose).toBe(true)
    })

    it('should allow empty output buffer', () => {
      const mask: OutputMask = {
        isSpinning: true,
        outputBuffer: [],
        stderrCapture: '',
        stdoutCapture: '',
        verbose: false,
      }
      expect(mask.outputBuffer).toEqual([])
    })

    it('should allow large output buffer', () => {
      const largeBuffer = Array.from({ length: 1000 }, (_, i) => `line ${i}`)
      const mask: OutputMask = {
        isSpinning: false,
        outputBuffer: largeBuffer,
        stderrCapture: '',
        stdoutCapture: '',
        verbose: true,
      }
      expect(mask.outputBuffer).toHaveLength(1000)
    })
  })

  describe('OutputMaskOptions type', () => {
    it('should accept minimal options', () => {
      const options: OutputMaskOptions = {}
      expect(options).toBeDefined()
    })

    it('should accept filter function with correct signature', () => {
      const options: OutputMaskOptions = {
        filterOutput: (text: string, stream: 'stdout' | 'stderr'): boolean => {
          return text.length > 0 && stream === 'stdout'
        },
      }
      expect(options.filterOutput).toBeDefined()
      if (options.filterOutput) {
        expect(options.filterOutput('test', 'stdout')).toBe(true)
        expect(options.filterOutput('test', 'stderr')).toBe(false)
      }
    })

    it('should accept override exit code function', () => {
      const options: OutputMaskOptions = {
        overrideExitCode: (
          code: number,
          _stdout: string,
          stderr: string,
        ): number | undefined => {
          if (code === 1 && stderr.includes('warning')) {
            return 0
          }
          return undefined
        },
      }
      expect(options.overrideExitCode).toBeDefined()
      if (options.overrideExitCode) {
        expect(options.overrideExitCode(1, '', 'warning: test')).toBe(0)
        expect(options.overrideExitCode(1, '', 'error')).toBeUndefined()
      }
    })
  })

  describe('edge cases', () => {
    it('should handle undefined options', () => {
      const mask = createOutputMask(undefined)
      expect(mask).toBeDefined()
      expect(mask.verbose).toBe(false)
    })

    it('should handle partial options', () => {
      const mask = createOutputMask({ message: 'Loading...' })
      expect(mask).toBeDefined()
      expect(mask.isSpinning).toBe(true)
    })
  })
})
