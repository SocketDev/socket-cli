// node --test specs for the shared shell-command parser util.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  commandsFor,
  findInvocation,
  hasOpaqueInvocation,
  invocationHasFlag,
  parseCommands,
} from '../shell-command.mts'

test('parseCommands: simple command → binary + args', () => {
  const [cmd] = parseCommands('git push origin main')
  assert.strictEqual(cmd!.binary, 'git')
  assert.deepStrictEqual(cmd!.args, ['push', 'origin', 'main'])
  assert.strictEqual(cmd!.viaVariable, false)
  assert.strictEqual(cmd!.viaEval, false)
})

test('parseCommands: leading assignments are separated from the binary', () => {
  const [cmd] = parseCommands('A=1 B=2 git push')
  assert.deepStrictEqual(cmd!.assignments, ['A=1', 'B=2'])
  assert.strictEqual(cmd!.binary, 'git')
  assert.deepStrictEqual(cmd!.args, ['push'])
})

test('parseCommands: && / ; / | split into separate segments', () => {
  const cmds = parseCommands('cd /x && git push ; echo done | cat')
  const bins = cmds.map(c => c.binary)
  assert.ok(bins.includes('cd'))
  assert.ok(bins.includes('git'))
  assert.ok(bins.includes('echo'))
  assert.ok(bins.includes('cat'))
})

test('parseCommands: $(…) substitution surfaces the inner command', () => {
  const cmds = parseCommands('git $(printf push)')
  const bins = cmds.map(c => c.binary)
  assert.ok(bins.includes('git'))
  assert.ok(bins.includes('printf'))
})

test('parseCommands: comments dropped', () => {
  const cmds = parseCommands('git push  # remember to do this')
  assert.strictEqual(cmds.length, 1)
  assert.strictEqual(cmds[0]!.binary, 'git')
})

test('findInvocation: matches plain git push', () => {
  assert.ok(findInvocation('git push origin main', { binary: 'git', subcommand: 'push' }))
})

test('findInvocation: matches git -C <dir> push (subcommand after option value)', () => {
  assert.ok(findInvocation('git -C /x push', { binary: 'git', subcommand: 'push' }))
})

test('findInvocation: matches git -c k=v push', () => {
  assert.ok(findInvocation('git -c foo=bar push', { binary: 'git', subcommand: 'push' }))
})

test('findInvocation: matches push reached via && chain', () => {
  assert.ok(
    findInvocation('cd /x/depot && git push', { binary: 'git', subcommand: 'push' }),
  )
})

test('findInvocation: matches push in a pipe chain', () => {
  assert.ok(
    findInvocation('ls | grep x && git push', { binary: 'git', subcommand: 'push' }),
  )
})

test('findInvocation: a different subcommand does not match', () => {
  assert.ok(!findInvocation('git status', { binary: 'git', subcommand: 'push' }))
})

test('findInvocation: quoted "git push" in a commit message is NOT a push', () => {
  assert.ok(
    !findInvocation('git commit -m "remember to git push later"', {
      binary: 'git',
      subcommand: 'push',
    }),
  )
})

test('findInvocation: binary-only query (no subcommand)', () => {
  assert.ok(findInvocation('gh auth status', { binary: 'gh' }))
  assert.ok(!findInvocation('git status', { binary: 'gh' }))
})

test('hasOpaqueInvocation: eval flagged', () => {
  assert.ok(hasOpaqueInvocation('eval "git push"'))
})

test('hasOpaqueInvocation: $VAR-sourced binary flagged', () => {
  assert.ok(hasOpaqueInvocation('g=git; $g push'))
})

test('hasOpaqueInvocation: plain command is not opaque', () => {
  assert.ok(!hasOpaqueInvocation('git push origin main'))
})

test('parseCommands: empty / unparseable input → empty list, no throw', () => {
  assert.deepStrictEqual(parseCommands(''), [])
})

test('commandsFor: returns matching segments with args', () => {
  const cmds = commandsFor('codex --write "do the thing"', 'codex')
  assert.strictEqual(cmds.length, 1)
  assert.ok(cmds[0]!.args.includes('--write'))
})

test('commandsFor: binary-in-a-path is NOT the binary', () => {
  // `codex-no-write-guard` as a path token must not count as invoking codex.
  assert.deepStrictEqual(commandsFor('ls codex-no-write-guard/', 'codex'), [])
  assert.deepStrictEqual(
    commandsFor('grep -n "codex --write" file.mts', 'codex'),
    [],
  )
})

test('invocationHasFlag: exact flag', () => {
  assert.ok(invocationHasFlag('codex --write prompt', 'codex', ['--write', '-w']))
  assert.ok(invocationHasFlag('codex -w prompt', 'codex', ['--write', '-w']))
})

test('invocationHasFlag: --flag=value form', () => {
  assert.ok(invocationHasFlag('codex --write=true x', 'codex', ['--write']))
})

test('invocationHasFlag: flag only inside a quoted string does NOT count', () => {
  // the flag is part of an arg STRING to a different binary
  assert.ok(!invocationHasFlag('echo "codex --write"', 'codex', ['--write']))
})

test('invocationHasFlag: flag on a different binary does NOT count', () => {
  assert.ok(!invocationHasFlag('rm --write-protect x', 'codex', ['--write']))
})
