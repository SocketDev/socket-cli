// node --test specs for the shared bash-quote-mask helper.
//
// Run from this dir:
//   node --test test/*.test.mts

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQuoteMask,
  containsOutsideQuotes,
  matchOutsideQuotes,
  stripHeredocBodies,
} from '../bash-quote-mask.mts'

test('buildQuoteMask: empty string', () => {
  assert.deepEqual(buildQuoteMask(''), [])
})

test("buildQuoteMask: plain text is all false", () => {
  const mask = buildQuoteMask('git status --short')
  assert.ok(mask.every(b => b === false))
})

test('buildQuoteMask: single-quoted region is true', () => {
  const s = "echo 'hi'"
  const mask = buildQuoteMask(s)
  // 'echo ' → 5 false
  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual(mask[i], false)
  }
  // "'hi'" → 4 true (open quote, h, i, close quote)
  for (let i = 5; i < 9; i += 1) {
    assert.strictEqual(mask[i], true)
  }
})

test('buildQuoteMask: double-quoted region is true', () => {
  const s = 'echo "hi"'
  const mask = buildQuoteMask(s)
  assert.strictEqual(mask[5], true) // "
  assert.strictEqual(mask[6], true) // h
  assert.strictEqual(mask[7], true) // i
  assert.strictEqual(mask[8], true) // "
})

test('buildQuoteMask: escaped double quote inside double quotes', () => {
  const s = 'echo "a\\"b"'
  const mask = buildQuoteMask(s)
  // 'a' is at index 6, the \\ at 7-8 should be marked, then "b" at 9, " at 10.
  assert.strictEqual(mask[5], true) // opening "
  assert.strictEqual(mask[6], true) // a
  assert.strictEqual(mask[7], true) // backslash (escape)
  assert.strictEqual(mask[8], true) // escaped "
  assert.strictEqual(mask[9], true) // b
  assert.strictEqual(mask[10], true) // closing "
})

test('buildQuoteMask: single quotes do not honor backslash', () => {
  // POSIX single quotes: backslash is literal. The runtime string is
  // `echo 'a\b'` (10 chars): e c h o ␠ ' a \ b '
  const s = "echo 'a\\b'"
  const mask = buildQuoteMask(s)
  assert.strictEqual(s.length, 10)
  // Opening quote through closing quote (indices 5..9) are all masked.
  for (let i = 5; i < 10; i += 1) {
    assert.strictEqual(mask[i], true, `index ${i} should be masked`)
  }
})

test('buildQuoteMask: single quotes nested inside double quotes are text', () => {
  // Inside a double-quoted string, ' is just a literal apostrophe.
  const s = 'echo "it\'s ok"'
  const mask = buildQuoteMask(s)
  // Every char from index 5 to end is inside the double-quoted region.
  for (let i = 5; i < s.length; i += 1) {
    assert.strictEqual(mask[i], true)
  }
})

test('stripHeredocBodies: replaces body with spaces, preserves length', () => {
  const s = "cat <<EOF\nhello\nworld\nEOF\nrest"
  const stripped = stripHeredocBodies(s)
  assert.strictEqual(stripped.length, s.length)
  // The word `hello` should be blanked out.
  assert.ok(!stripped.includes('hello'))
  // The opening `<<EOF` and closing `EOF` remain.
  assert.ok(stripped.includes('<<EOF'))
  // `rest` after the heredoc is untouched.
  assert.ok(stripped.endsWith('rest'))
})

test('stripHeredocBodies: handles quoted delimiter', () => {
  const s = "cat <<'EOF'\nbody\nEOF"
  const stripped = stripHeredocBodies(s)
  assert.ok(!stripped.includes('body'))
})

test('stripHeredocBodies: handles tab-stripped form', () => {
  const s = "cat <<-EOF\n\tbody\n\tEOF"
  const stripped = stripHeredocBodies(s)
  assert.ok(!stripped.includes('body'))
})

test('containsOutsideQuotes: matches free text', () => {
  assert.ok(containsOutsideQuotes('node --bad-flag foo', /--bad-flag/))
})

test('containsOutsideQuotes: does not match inside single quotes', () => {
  assert.ok(
    !containsOutsideQuotes(
      "echo 'reminder: --bad-flag is gone'",
      /--bad-flag/,
    ),
  )
})

test('containsOutsideQuotes: does not match inside double quotes', () => {
  assert.ok(
    !containsOutsideQuotes(
      'echo "reminder: --bad-flag is gone"',
      /--bad-flag/,
    ),
  )
})

test('containsOutsideQuotes: does not match inside heredoc body', () => {
  assert.ok(
    !containsOutsideQuotes(
      "git commit -m \"$(cat <<'EOF'\nmention --bad-flag here\nEOF\n)\"",
      /--bad-flag/,
    ),
  )
})

test('containsOutsideQuotes: matches when both quoted + unquoted occurrences exist', () => {
  assert.ok(
    containsOutsideQuotes(
      "echo 'tip: --bad-flag' && node --bad-flag foo",
      /--bad-flag/,
    ),
  )
})

test('matchOutsideQuotes: returns the unquoted match', () => {
  const m = matchOutsideQuotes(
    "echo 'noise --x' && node --x foo",
    /--x/,
  )
  assert.ok(m)
  // The unquoted occurrence sits at the end, well past the quoted one.
  assert.ok(m!.index > 20)
})

test('matchOutsideQuotes: handles non-global regex by cloning', () => {
  const m = matchOutsideQuotes('node --x foo', /--x/)
  assert.ok(m)
  assert.strictEqual(m![0], '--x')
})
