/**
 * @file Unit tests for the alpha-sort-reminder detector.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { findUnsortedBlocks } from '../index.mts'

describe('alpha-sort-reminder / findUnsortedBlocks', () => {
  test('JSON: flags out-of-order object keys', () => {
    const code = '{\n  "gamma": 1,\n  "alpha": 2,\n  "beta": 3\n}\n'
    const f = findUnsortedBlocks('config.json', code)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.surface, 'json')
  })

  test('JSON: quiet on sorted keys', () => {
    const code = '{\n  "alpha": 1,\n  "beta": 2,\n  "gamma": 3\n}\n'
    assert.equal(findUnsortedBlocks('config.json', code).length, 0)
  })

  test('JSON: quiet on a 2-key run (below MIN_RUN)', () => {
    const code = '{\n  "gamma": 1,\n  "alpha": 2\n}\n'
    assert.equal(findUnsortedBlocks('config.json', code).length, 0)
  })

  test('JSON: nested object at different indent is its own run', () => {
    // outer keys sorted; inner keys sorted — no finding.
    const code =
      '{\n  "a": {\n    "x": 1,\n    "y": 2,\n    "z": 3\n  },\n  "b": 2,\n  "c": 3\n}\n'
    assert.equal(findUnsortedBlocks('config.json', code).length, 0)
  })

  test('YAML: flags out-of-order env block', () => {
    const code = 'env:\n  ZED: 1\n  ALPHA: 2\n  MID: 3\n'
    const f = findUnsortedBlocks('ci.yml', code)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.surface, 'yaml')
  })

  test('YAML: ignores sequence items and comments', () => {
    const code = 'steps:\n  # a comment\n  - uses: foo\n  - uses: bar\n'
    assert.equal(findUnsortedBlocks('ci.yml', code).length, 0)
  })

  test('markdown: flags out-of-order bullets', () => {
    const code = '- zebra\n- apple\n- mango\n'
    const f = findUnsortedBlocks('README.md', code)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.surface, 'markdown')
  })

  test('markdown: flags trailing ellipsis even when sorted', () => {
    const code = '- apple\n- banana, ...\n'
    const f = findUnsortedBlocks('README.md', code)
    assert.equal(f.length, 1)
    assert.match(f[0]!.hint, /ellipsis/)
  })

  test('markdown: quiet on sorted bullets', () => {
    const code = '- apple\n- mango\n- zebra\n'
    assert.equal(findUnsortedBlocks('README.md', code).length, 0)
  })

  test('bash: flags out-of-order cache-key vars', () => {
    const code = 'ZED_LIB=$(hash)\nALPHA_LIB=$(hash)\nMID_LIB=$(hash)\n'
    const f = findUnsortedBlocks('build.sh', code)
    assert.equal(f.length, 1)
    assert.equal(f[0]!.surface, 'bash')
  })

  test('bash: quiet on sorted vars', () => {
    const code = 'ALPHA_LIB=$(hash)\nMID_LIB=$(hash)\nZED_LIB=$(hash)\n'
    assert.equal(findUnsortedBlocks('build.sh', code).length, 0)
  })

  test('unknown extension: no findings', () => {
    const code = 'const o = { b: 1, a: 2 }\n'
    assert.equal(findUnsortedBlocks('app.ts', code).length, 0)
  })
})
