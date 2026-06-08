/**
 * @file Unit tests for no-screenshot-guard — screenshotBinaryIn classifies a
 *   Bash command into a screen-capture tool invocation (vs unrelated commands
 *   and path-fragment false-positives).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { screenshotBinaryIn } from '../index.mts'

test('macOS screencapture is flagged', () => {
  assert.equal(screenshotBinaryIn('screencapture -x /tmp/shot.png'), 'screencapture')
})

test('Linux scrot / grim / maim / import are flagged', () => {
  assert.equal(screenshotBinaryIn('scrot out.png'), 'scrot')
  assert.equal(screenshotBinaryIn('grim /tmp/s.png'), 'grim')
  assert.equal(screenshotBinaryIn('maim > s.png'), 'maim')
  assert.equal(screenshotBinaryIn('import -window root s.png'), 'import')
})

test('gnome-screenshot / spectacle / flameshot are flagged', () => {
  assert.equal(screenshotBinaryIn('gnome-screenshot -f s.png'), 'gnome-screenshot')
  assert.equal(screenshotBinaryIn('spectacle -b -o s.png'), 'spectacle')
  assert.equal(screenshotBinaryIn('flameshot full -p .'), 'flameshot')
})

test('Windows snippingtool is flagged', () => {
  assert.equal(screenshotBinaryIn('snippingtool /clip'), 'snippingtool')
})

test('a command with no screenshot tool is not flagged', () => {
  assert.equal(screenshotBinaryIn('git status && node build.mts'), undefined)
})

test('a screenshot tool piped from another command is still flagged', () => {
  assert.equal(screenshotBinaryIn('echo go && screencapture -i s.png'), 'screencapture')
})

test('a path fragment containing a binary name does not false-fire', () => {
  // `screencapture-helper` is a different word; the parsed binary is `cat`.
  assert.equal(screenshotBinaryIn('cat ./screencapture-notes.txt'), undefined)
})

test('an unrelated import (e.g. node import) is the ImageMagick `import` only when the binary', () => {
  // A JS `import` statement is never a Bash command; here `node` is the binary.
  assert.equal(screenshotBinaryIn('node --import tsx app.mts'), undefined)
})
