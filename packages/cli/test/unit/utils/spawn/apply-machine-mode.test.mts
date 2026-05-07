/**
 * Unit tests for the machine-mode-aware spawn helpers.
 *
 * Test Coverage:
 * - applyMachineModeIfActive returns inputs unchanged when ambient
 *   machine-mode is off (no JSON/markdown/quiet flag in flight).
 * - applyMachineModeIfActive defers to the raw applier when ambient
 *   mode is engaged.
 * - inferSubcommand returns the first non-flag token.
 * - inferSubcommand returns undefined when there's no subcommand
 *   (empty argv, all flags).
 *
 * Related Files:
 * - src/utils/spawn/apply-machine-mode.mts - Implementation
 * - src/utils/spawn/machine-mode.mts - Inner applier
 * - src/utils/output/ambient-mode.mts - Mode getter/setter
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  resetMachineOutputMode,
  setMachineOutputMode,
} from '../../../../src/utils/output/ambient-mode.mts'
import {
  applyMachineModeIfActive,
  inferSubcommand,
} from '../../../../src/utils/spawn/apply-machine-mode.mts'

describe('applyMachineModeIfActive', () => {
  beforeEach(() => {
    resetMachineOutputMode()
  })
  afterEach(() => {
    resetMachineOutputMode()
  })

  it('returns the inputs unchanged when ambient mode is off', () => {
    const input = {
      args: ['install', 'lodash'],
      env: { FOO: 'bar' },
    }
    const out = applyMachineModeIfActive(input)
    expect(out.args).toEqual(['install', 'lodash'])
    expect(out.env).toEqual({ FOO: 'bar' })
    // Returned objects are fresh copies — caller can mutate without
    // affecting input.
    expect(out.args).not.toBe(input.args)
    expect(out.env).not.toBe(input.env)
  })

  it('forwards to the raw applier when --json is in flight', () => {
    setMachineOutputMode({ json: true })
    const out = applyMachineModeIfActive({
      args: ['npm', 'install'],
      env: {},
    })
    // The raw applier injects machine-mode signals (env vars / flags)
    // for the package manager. We don't pin the exact shape here —
    // just that it differed from the no-op return.
    const noOp = { args: ['npm', 'install'], env: {} }
    expect(out).not.toEqual(noOp)
  })
})

describe('inferSubcommand', () => {
  it('returns the first non-flag argument', () => {
    expect(inferSubcommand(['install', '--save'])).toBe('install')
    expect(inferSubcommand(['--save', 'install'])).toBe('install')
    expect(inferSubcommand(['-D', '--no-frozen', 'add', 'pkg'])).toBe('add')
  })

  it('returns the first arg even when it has no flag-like sibling', () => {
    expect(inferSubcommand(['ls'])).toBe('ls')
  })

  it('returns undefined for an empty argv', () => {
    expect(inferSubcommand([])).toBeUndefined()
  })

  it('returns undefined when every argument is a flag', () => {
    expect(inferSubcommand(['--help', '-v'])).toBeUndefined()
  })
})
