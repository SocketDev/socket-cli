/**
 * @file Unit tests for the pure narrowing helpers in payload.mts. The stdin /
 *   process-exit wrappers (readPayload / withBashGuard / withEditGuard) are
 *   covered by the per-hook subprocess test suites, which exercise the real
 *   stdin + exit-code path; unit-testing them in-process would terminate the
 *   test runner via process.exit.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { readCommand, readFilePath, readWriteContent } from '../payload.mts'

describe('readCommand', () => {
  test('returns a string command', () => {
    assert.equal(
      readCommand({ tool_input: { command: 'git push' } }),
      'git push',
    )
  })
  test('undefined for non-string / missing', () => {
    assert.equal(readCommand({ tool_input: { command: 42 } }), undefined)
    assert.equal(readCommand({ tool_input: {} }), undefined)
    assert.equal(readCommand({}), undefined)
  })
})

describe('readFilePath', () => {
  test('returns a string path', () => {
    assert.equal(
      readFilePath({ tool_input: { file_path: '/a/b.ts' } }),
      '/a/b.ts',
    )
  })
  test('undefined for non-string / missing', () => {
    assert.equal(readFilePath({ tool_input: { file_path: 0 } }), undefined)
    assert.equal(readFilePath({}), undefined)
  })
})

describe('readWriteContent', () => {
  test('prefers content (Write)', () => {
    assert.equal(
      readWriteContent({ tool_input: { content: 'w', new_string: 'e' } }),
      'w',
    )
  })
  test('falls back to new_string (Edit)', () => {
    assert.equal(readWriteContent({ tool_input: { new_string: 'e' } }), 'e')
  })
  test('undefined when neither present / non-string', () => {
    assert.equal(readWriteContent({ tool_input: { content: 5 } }), undefined)
    assert.equal(readWriteContent({}), undefined)
  })
})
