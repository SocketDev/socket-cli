import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  bundleStubOffer,
  detectBundler,
} from '../../../../src/commands/optimize/bundle-stub-offer.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('detectBundler', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-stub-offer-'))
  })

  afterEach(async () => {
    await safeDelete(dir)
  })

  function write(rel: string, content = '') {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }

  it('detects rolldown from a config file', () => {
    write('.config/rolldown.build.mts')
    expect(detectBundler(dir)).toBe('rolldown')
  })

  it('detects rollup from a config file', () => {
    write('rollup.config.mjs')
    expect(detectBundler(dir)).toBe('rollup')
  })

  it('detects each bundler from the package.json script bodies', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { build: 'esbuild src --bundle' } }),
    )
    expect(detectBundler(dir)).toBe('esbuild')
    write('package.json', JSON.stringify({ scripts: { build: 'rolldown -c' } }))
    expect(detectBundler(dir)).toBe('rolldown')
    write('package.json', JSON.stringify({ scripts: { build: 'rollup -c' } }))
    expect(detectBundler(dir)).toBe('rollup')
  })

  it('prefers config files over script bodies', () => {
    write('.config/rolldown.build.mts')
    write(
      'package.json',
      JSON.stringify({ scripts: { build: 'esbuild src --bundle' } }),
    )
    expect(detectBundler(dir)).toBe('rolldown')
  })

  it('stays silent when nothing points at a bundler', () => {
    write(
      'package.json',
      JSON.stringify({ name: 'x', scripts: { test: 'vitest' } }),
    )
    expect(detectBundler(dir)).toBeUndefined()
    expect(bundleStubOffer(dir)).toBeUndefined()
  })
})

describe('bundleStubOffer', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-stub-offer-'))
    mkdirSync(path.join(dir, '.config'), { recursive: true })
    writeFileSync(path.join(dir, '.config', 'rolldown.build.mts'), '')
  })

  afterEach(async () => {
    await safeDelete(dir)
  })

  it('returns the bundler, the snippet, and the reachability rule', () => {
    const offer = bundleStubOffer(dir)
    expect(offer?.bundler).toBe('rolldown')
    expect(offer?.snippet).toContain('createBundleStubPlugin')
    expect(offer?.snippet).toContain('stubPattern')
    expect(offer?.summary).toContain('rolldown')
    expect(offer?.summary).toContain('rebuild')
  })
})
