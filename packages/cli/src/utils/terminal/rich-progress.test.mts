/**
 * @fileoverview Tests for rich progress indicators and spinners.
 * Validates MultiProgress, Spinner, and FileProgress components.
 */

import { Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProgress, MultiProgress, Spinner } from './rich-progress.mts'

// Mock writable stream for capturing output.
class MockWritable extends Writable {
  chunks: string[] = []

  _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString())
    callback()
  }

  getOutput(): string {
    return this.chunks.join('')
  }

  clear(): void {
    this.chunks = []
  }
}

describe('rich-progress', () => {
  describe('MultiProgress', () => {
    let mockStream: MockWritable
    let progress: MultiProgress

    beforeEach(() => {
      vi.useFakeTimers()
      mockStream = new MockWritable()
      progress = new MultiProgress({ stream: mockStream, hideCursor: false })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('should create instance with default options', () => {
      const defaultProgress = new MultiProgress()
      expect(defaultProgress).toBeInstanceOf(MultiProgress)
    })

    it('should add task', () => {
      progress.addTask('task1', 'Processing files', 100)
      expect(() => progress.updateTask('task1', 50)).not.toThrow()
    })

    it('should update task progress', () => {
      progress.addTask('task1', 'Processing files', 100)
      progress.updateTask('task1', 50)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Processing files')
      expect(output).toContain('50%')
    })

    it('should mark task as done when reaching total', () => {
      progress.addTask('task1', 'Processing files', 100)
      progress.updateTask('task1', 100)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Processing files')
      expect(output).toContain('100%')
    })

    it('should handle task failure', () => {
      progress.addTask('task1', 'Processing files', 100)
      progress.failTask('task1', 'Error occurred')
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Processing files')
      expect(output).toContain('Error occurred')
    })

    it('should track multiple tasks', () => {
      progress.addTask('task1', 'Task 1', 50)
      progress.addTask('task2', 'Task 2', 75)
      progress.updateTask('task1', 25)
      progress.updateTask('task2', 50)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Task 1')
      expect(output).toContain('Task 2')
    })

    it('should update task with custom tokens', () => {
      progress.addTask('task1', 'Download', 100)
      progress.updateTask('task1', 50, { file: 'package.json' })
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Download')
      expect(output).toContain('package.json')
    })

    it('should handle non-existent task updates gracefully', () => {
      expect(() => progress.updateTask('nonexistent', 50)).not.toThrow()
      expect(() => progress.failTask('nonexistent', 'Error')).not.toThrow()
    })

    it('should hide cursor when hideCursor is true', () => {
      const progressWithHiddenCursor = new MultiProgress({
        stream: mockStream,
        hideCursor: true,
      })
      progressWithHiddenCursor.addTask('task1', 'Test', 100)
      progressWithHiddenCursor.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('\x1B[?25l') // Hide cursor sequence
      expect(output).toContain('\x1B[?25h') // Show cursor sequence
    })

    it('should calculate progress percentage correctly', () => {
      progress.addTask('task1', 'Test', 200)
      progress.updateTask('task1', 50)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('25%')
    })

    it('should handle zero total gracefully', () => {
      progress.addTask('task1', 'Test', 0)
      progress.updateTask('task1', 0)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('Test')
      expect(output).toContain('0%')
    })

    it('should display elapsed time', () => {
      progress.addTask('task1', 'Test', 100)
      progress.updateTask('task1', 50)
      // Advance time to simulate elapsed time
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toMatch(/\d+\.\d+s/) // Should contain elapsed time
    })

    it('should render progress bar with correct fill', () => {
      progress.addTask('task1', 'Test', 100)
      progress.updateTask('task1', 50)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      const output = mockStream.getOutput()
      expect(output).toContain('█') // Filled bar character
      expect(output).toContain('░') // Empty bar character
    })

    it('should display status symbols', () => {
      const p1 = new MultiProgress({ stream: mockStream })
      p1.addTask('pending', 'Pending', 100)
      vi.advanceTimersByTime(100) // Trigger render
      p1.stop()
      mockStream.clear()

      const p2 = new MultiProgress({ stream: mockStream })
      p2.addTask('running', 'Running', 100)
      p2.updateTask('running', 50)
      vi.advanceTimersByTime(100) // Trigger render
      p2.stop()
      mockStream.clear()

      const p3 = new MultiProgress({ stream: mockStream })
      p3.addTask('done', 'Done', 100)
      p3.updateTask('done', 100)
      vi.advanceTimersByTime(100) // Trigger render
      p3.stop()
      mockStream.clear()

      const p4 = new MultiProgress({ stream: mockStream })
      p4.addTask('failed', 'Failed', 100)
      p4.failTask('failed')
      vi.advanceTimersByTime(100) // Trigger render
      p4.stop()

      // At least one output should contain status symbols
      expect(mockStream.getOutput()).toBeTruthy()
    })
  })

  describe('Spinner', () => {
    let mockStream: MockWritable
    let spinner: Spinner

    beforeEach(() => {
      vi.useFakeTimers()
      mockStream = new MockWritable()
      spinner = new Spinner('Loading...', mockStream)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should create spinner with message', () => {
      expect(spinner).toBeInstanceOf(Spinner)
    })

    it('should start spinner', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed()

      const output = mockStream.getOutput()
      expect(output).toContain('Loading...')
    })

    it('should cycle through frames', () => {
      getDefaultSpinner().start()

      mockStream.clear()
      vi.advanceTimersByTime(80)
      const frame1 = mockStream.getOutput()

      mockStream.clear()
      vi.advanceTimersByTime(80)
      const frame2 = mockStream.getOutput()

      getDefaultSpinner().succeed()

      // Frames should be different (different spinner characters)
      expect(frame1).not.toBe(frame2)
    })

    it('should update message', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().update('Processing...')
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed()

      const output = mockStream.getOutput()
      expect(output).toContain('Processing...')
    })

    it('should succeed with checkmark', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed()

      const output = mockStream.getOutput()
      expect(output).toContain('✓')
    })

    it('should succeed with custom message', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed('Done!')

      const output = mockStream.getOutput()
      expect(output).toContain('✓')
      expect(output).toContain('Done!')
    })

    it('should fail with cross mark', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().fail()

      const output = mockStream.getOutput()
      expect(output).toContain('✗')
    })

    it('should fail with custom message', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().fail('Error occurred')

      const output = mockStream.getOutput()
      expect(output).toContain('✗')
      expect(output).toContain('Error occurred')
    })

    it('should clear line when stopped', () => {
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed()

      const output = mockStream.getOutput()
      expect(output).toContain('\r\x1B[2K') // Clear line sequence
    })

    it('should not crash if stopped without starting', () => {
      expect(() => getDefaultSpinner().succeed()).not.toThrow()
    })
  })

  describe('FileProgress', () => {
    it('should create file progress tracker', () => {
      const files = ['file1.js', 'file2.js', 'file3.js']
      const progress = new FileProgress(files, 'Processing')
      expect(progress).toBeInstanceOf(FileProgress)
    })

    it('should track file processing', () => {
      // Capture stderr output
      const originalWrite = process.stderr.write
      let output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      }

      try {
        const files = ['file1.js', 'file2.js']
        const progress = new FileProgress(files, 'Processing')
        progress.next('file1.js')

        expect(output).toContain('file1.js')
        expect(output).toContain('50%')
        expect(output).toContain('[1/2]')
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it('should calculate percentage correctly', () => {
      const originalWrite = process.stderr.write
      let output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      }

      try {
        const files = ['f1', 'f2', 'f3', 'f4']
        const progress = new FileProgress(files)
        progress.next('f1')
        expect(output).toContain('25%')

        output = ''
        progress.next('f2')
        expect(output).toContain('50%')

        output = ''
        progress.next('f3')
        expect(output).toContain('75%')

        output = ''
        progress.next('f4')
        expect(output).toContain('100%')
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it('should display elapsed time', () => {
      const originalWrite = process.stderr.write
      let output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      }

      try {
        const files = ['file1.js']
        const progress = new FileProgress(files)
        progress.next('file1.js')

        expect(output).toMatch(/\(\d+\.\d+s\)/) // Should contain elapsed time in parentheses
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it('should write newline after last file', () => {
      const originalWrite = process.stderr.write
      let output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      }

      try {
        const files = ['file1.js', 'file2.js']
        const progress = new FileProgress(files)
        progress.next('file1.js')
        progress.next('file2.js')

        expect(output).toContain('\n')
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it('should use custom operation name', () => {
      const originalWrite = process.stderr.write
      let output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        output += chunk.toString()
        return true
      }

      try {
        const files = ['file1.js']
        const progress = new FileProgress(files, 'Analyzing')
        progress.next('file1.js')

        expect(output).toContain('Analyzing')
      } finally {
        process.stderr.write = originalWrite
      }
    })

    it('should handle empty file list', () => {
      const originalWrite = process.stderr.write
      let _output = ''
      process.stderr.write = (chunk: string | Buffer): boolean => {
        _output += chunk.toString()
        return true
      }

      try {
        const files: string[] = []
        const progress = new FileProgress(files)
        // Should not crash on empty list
        expect(progress).toBeInstanceOf(FileProgress)
      } finally {
        process.stderr.write = originalWrite
      }
    })
  })

  describe('CI and VITEST mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('should handle progress indicators in test environment', () => {
      // Progress indicators should work in test mode but not display animations
      const mockStream = new MockWritable()
      const progress = new MultiProgress({ stream: mockStream })
      progress.addTask('test', 'Test task', 100)
      progress.updateTask('test', 50)
      vi.advanceTimersByTime(100) // Trigger render
      progress.stop()

      // Should not throw and should produce output
      expect(mockStream.getOutput()).toBeTruthy()
    })

    it('should handle spinners in test environment', () => {
      const mockStream = new MockWritable()
      const _spinner = new Spinner('Test', mockStream)
      getDefaultSpinner().start()
      vi.advanceTimersByTime(100)
      getDefaultSpinner().succeed()

      // Should not throw
      expect(mockStream.getOutput()).toBeTruthy()
    })
  })
})
