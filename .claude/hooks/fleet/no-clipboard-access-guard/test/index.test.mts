/**
 * @file Unit tests for no-clipboard-access-guard — the structural matchers that
 *   classify a Bash command (clipboard CLI) and Edit/Write content (OSC-52
 *   escape) into a block decision, plus the per-tool gating in
 *   clipboardViolation.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clipboardBinaryIn,
  clipboardViolation,
  hasOsc52,
} from '../index.mts'

// ── clipboardBinaryIn (Bash) ────────────────────────────────────

test('pbcopy is flagged', () => {
  assert.equal(clipboardBinaryIn('echo secret | pbcopy'), 'pbcopy')
})

test('pbpaste is flagged', () => {
  assert.equal(clipboardBinaryIn('pbpaste > out.txt'), 'pbpaste')
})

test('xclip / xsel / wl-copy are flagged', () => {
  assert.equal(clipboardBinaryIn('echo x | xclip -selection clipboard'), 'xclip')
  assert.equal(clipboardBinaryIn('xsel -b'), 'xsel')
  assert.equal(clipboardBinaryIn('printf y | wl-copy'), 'wl-copy')
})

test('clip.exe is flagged', () => {
  assert.equal(clipboardBinaryIn('echo z | clip.exe'), 'clip.exe')
})

test('a command with no clipboard tool is not flagged', () => {
  assert.equal(clipboardBinaryIn('git status && node build.mts'), undefined)
})

test('a path fragment containing a binary name does not false-fire', () => {
  // `pbcopyrc` is a different word; findInvocation parses the command, so the
  // binary is `cat`, not `pbcopy`.
  assert.equal(clipboardBinaryIn('cat ./pbcopyrc'), undefined)
})

// ── hasOsc52 (Edit/Write content) ───────────────────────────────

test('hasOsc52 detects the raw ESC byte spelling', () => {
  assert.equal(hasOsc52('process.stdout.write("\x1b]52;c;Zm9v")'), true)
})

test('hasOsc52 detects the escaped \\x1b / \\033 / \\u001b spellings', () => {
  assert.equal(hasOsc52('const s = "\\x1b]52;c;..."'), true)
  assert.equal(hasOsc52('const s = "\\033]52;c;..."'), true)
  assert.equal(hasOsc52('const s = "\\u001b]52;c;..."'), true)
})

test('hasOsc52 is false on ordinary content + other OSC codes', () => {
  assert.equal(hasOsc52('const title = "\\x1b]0;my term title\\x07"'), false)
  assert.equal(hasOsc52('just some normal source text'), false)
})

// ── clipboardViolation (per-tool gating) ────────────────────────

test('Bash + clipboard CLI -> violation', () => {
  const reason = clipboardViolation({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi | pbcopy' },
  })
  assert.ok(reason?.includes('pbcopy'))
})

test('Edit + OSC-52 content -> violation', () => {
  const reason = clipboardViolation({
    tool_name: 'Edit',
    tool_input: { new_string: 'write("\\x1b]52;c;data")' },
  })
  assert.ok(reason?.includes('OSC-52'))
})

test('Write + OSC-52 content -> violation', () => {
  const reason = clipboardViolation({
    tool_name: 'Write',
    tool_input: { content: 'write("\\x1b]52;c;data")' },
  })
  assert.ok(reason?.includes('OSC-52'))
})

test('Bash without clipboard tool -> no violation', () => {
  assert.equal(
    clipboardViolation({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
    undefined,
  )
})

test('Edit without OSC-52 -> no violation', () => {
  assert.equal(
    clipboardViolation({
      tool_name: 'Edit',
      tool_input: { new_string: 'const x = 1' },
    }),
    undefined,
  )
})

test('a clipboard CLI inside Edit content is NOT a Bash violation', () => {
  // pbcopy mentioned in source text is not a Bash invocation; the Edit branch
  // only checks OSC-52, so this passes.
  assert.equal(
    clipboardViolation({
      tool_name: 'Edit',
      tool_input: { new_string: '// see pbcopy docs' },
    }),
    undefined,
  )
})

test('missing tool_input fails open (no violation)', () => {
  assert.equal(clipboardViolation({ tool_name: 'Bash' }), undefined)
})

test('an unrelated tool is not gated', () => {
  assert.equal(
    clipboardViolation({ tool_name: 'Read', tool_input: { command: 'pbcopy' } }),
    undefined,
  )
})
