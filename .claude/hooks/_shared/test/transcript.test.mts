// node --test specs for the shared transcript helper.
//
// Run from this dir:
//   node --test test/*.test.mts

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bypassPhrasePresent,
  readLastAssistantText,
  readUserText,
} from '../transcript.mts'

function writeTranscript(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'transcript-test-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, content)
  return file
}

function cleanup(file: string): void {
  rmSync(path.dirname(file), { recursive: true, force: true })
}

test('readUserText: undefined path returns empty', () => {
  assert.equal(readUserText(undefined), '')
})

test('readUserText: missing file returns empty', () => {
  assert.equal(readUserText('/tmp/does-not-exist-xyz.jsonl'), '')
})

test('readUserText: bare role+content shape', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'hello' }),
      JSON.stringify({ role: 'assistant', content: 'hi' }),
    ].join('\n'),
  )
  try {
    assert.equal(readUserText(f), 'hello')
  } finally {
    cleanup(f)
  }
})

test('readUserText: nested message.content string shape', () => {
  const f = writeTranscript(
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'nested text' },
    }),
  )
  try {
    assert.equal(readUserText(f), 'nested text')
  } finally {
    cleanup(f)
  }
})

test('readUserText: array-of-blocks content shape', () => {
  const f = writeTranscript(
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'block one' },
          { type: 'text', text: 'block two' },
        ],
      },
    }),
  )
  try {
    assert.equal(readUserText(f), 'block one\nblock two')
  } finally {
    cleanup(f)
  }
})

test('readUserText: skips assistant turns', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'user one' }),
      JSON.stringify({ role: 'assistant', content: 'assistant one' }),
      JSON.stringify({ role: 'user', content: 'user two' }),
    ].join('\n'),
  )
  try {
    assert.equal(readUserText(f), 'user one\nuser two')
  } finally {
    cleanup(f)
  }
})

test('readUserText: skips malformed JSON lines', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'good' }),
      'not json',
      JSON.stringify({ role: 'user', content: 'also good' }),
    ].join('\n'),
  )
  try {
    assert.equal(readUserText(f), 'good\nalso good')
  } finally {
    cleanup(f)
  }
})

test('readUserText: lookbackUserTurns=1 returns only the most-recent user turn', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'first' }),
      JSON.stringify({ role: 'assistant', content: 'reply' }),
      JSON.stringify({ role: 'user', content: 'second' }),
      JSON.stringify({ role: 'assistant', content: 'reply' }),
      JSON.stringify({ role: 'user', content: 'third' }),
    ].join('\n'),
  )
  try {
    assert.equal(readUserText(f, 1), 'third')
  } finally {
    cleanup(f)
  }
})

test('readUserText: lookbackUserTurns=2 returns the two most-recent user turns', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'first' }),
      JSON.stringify({ role: 'user', content: 'second' }),
      JSON.stringify({ role: 'user', content: 'third' }),
    ].join('\n'),
  )
  try {
    // Reversed in chronological order at return time.
    assert.equal(readUserText(f, 2), 'second\nthird')
  } finally {
    cleanup(f)
  }
})

test('bypassPhrasePresent: finds the phrase', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'Allow revert bypass please' }),
  )
  try {
    assert.equal(
      bypassPhrasePresent(f, 'Allow revert bypass'),
      true,
    )
  } finally {
    cleanup(f)
  }
})

test('bypassPhrasePresent: case-sensitive (lowercase does not count)', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'allow revert bypass please' }),
  )
  try {
    assert.equal(
      bypassPhrasePresent(f, 'Allow revert bypass'),
      false,
    )
  } finally {
    cleanup(f)
  }
})

test('bypassPhrasePresent: paraphrase does not count', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'please revert that' }),
  )
  try {
    assert.equal(
      bypassPhrasePresent(f, 'Allow revert bypass'),
      false,
    )
  } finally {
    cleanup(f)
  }
})

test('bypassPhrasePresent: missing transcript returns false', () => {
  assert.equal(
    bypassPhrasePresent(undefined, 'Allow revert bypass'),
    false,
  )
})

test('bypassPhrasePresent: array of equivalent spellings — any matches', () => {
  const variants = [
    'Allow soaktime bypass',
    'Allow soak time bypass',
    'Allow soak-time bypass',
  ]
  for (const present of variants) {
    const f = writeTranscript(
      JSON.stringify({ role: 'user', content: `please ${present} now` }),
    )
    try {
      assert.equal(bypassPhrasePresent(f, variants), true)
    } finally {
      cleanup(f)
    }
  }
})

test('bypassPhrasePresent: array — none matches', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'please bypass the soak rule' }),
  )
  try {
    assert.equal(
      bypassPhrasePresent(f, [
        'Allow soaktime bypass',
        'Allow soak time bypass',
        'Allow soak-time bypass',
      ]),
      false,
    )
  } finally {
    cleanup(f)
  }
})

test('bypassPhrasePresent: empty array returns false', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'Allow anything bypass' }),
  )
  try {
    assert.equal(bypassPhrasePresent(f, []), false)
  } finally {
    cleanup(f)
  }
})

test('readLastAssistantText: returns most-recent assistant turn', () => {
  const f = writeTranscript(
    [
      JSON.stringify({ role: 'user', content: 'user one' }),
      JSON.stringify({ role: 'assistant', content: 'assistant one' }),
      JSON.stringify({ role: 'user', content: 'user two' }),
      JSON.stringify({ role: 'assistant', content: 'assistant two' }),
    ].join('\n'),
  )
  try {
    assert.equal(readLastAssistantText(f), 'assistant two')
  } finally {
    cleanup(f)
  }
})

test('readLastAssistantText: returns empty when no assistant turn', () => {
  const f = writeTranscript(
    JSON.stringify({ role: 'user', content: 'user only' }),
  )
  try {
    assert.equal(readLastAssistantText(f), '')
  } finally {
    cleanup(f)
  }
})

test('readLastAssistantText: handles array-of-blocks shape', () => {
  const f = writeTranscript(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'block one' },
          { type: 'text', text: 'block two' },
        ],
      },
    }),
  )
  try {
    assert.equal(readLastAssistantText(f), 'block one\nblock two')
  } finally {
    cleanup(f)
  }
})

test('readLastAssistantText: undefined path returns empty', () => {
  assert.equal(readLastAssistantText(undefined), '')
})
