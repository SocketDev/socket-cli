/**
 * @fileoverview Tests for the shell-rc env-var block writer.
 *
 * Drives installShellRcBridge / uninstallShellRcBridge against a
 * temp HOME so the real `~/.zshenv` never gets touched. macOS-only
 * (matches the implementation gate); on non-macOS hosts the
 * functions return `undefined` / `false` and the assertions skip
 * the rewrite-shape checks.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { platform, tmpdir } from 'node:os'
import path from 'node:path'

const IS_MACOS = platform() === 'darwin'

const FAKE_TOKEN = 'sk-test-aaaabbbbccccddddeeeeffff'

function withFakeHome(fn: (rcPath: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const fake = mkdtempSync(path.join(tmpdir(), 'shell-rc-bridge-test-'))
    const prevHome = process.env['HOME']
    const prevShell = process.env['SHELL']
    process.env['HOME'] = fake
    process.env['SHELL'] = '/bin/zsh'
    try {
      // zsh target is .zshenv.
      const rcPath = path.join(fake, '.zshenv')
      await fn(rcPath)
    } finally {
      if (prevHome === undefined) {
        delete process.env['HOME']
      } else {
        process.env['HOME'] = prevHome
      }
      if (prevShell === undefined) {
        delete process.env['SHELL']
      } else {
        process.env['SHELL'] = prevShell
      }
      rmSync(fake, { recursive: true, force: true })
    }
  }
}

test(
  'installShellRcBridge inserts the block with a literal token export',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '# existing\nexport PATH=$PATH:/foo\n')
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    const r = installShellRcBridge(FAKE_TOKEN)
    assert.ok(r)
    assert.equal(r.outcome, 'inserted')
    const content = readFileSync(rcPath, 'utf8')
    assert.match(content, /BEGIN socket-cli env/)
    assert.match(content, /END socket-cli env/)
    // Token literal exported under both names.
    assert.match(
      content,
      new RegExp(`export SOCKET_API_TOKEN='${FAKE_TOKEN}'`),
    )
    assert.match(
      content,
      new RegExp(`export SOCKET_API_KEY='${FAKE_TOKEN}'`),
    )
    // NO live keychain CALL — `security find-generic-password` may
    // appear in a `#` doc comment that points the user at the
    // canonical store, but it must NOT be inside a `$(...)` or
    // backtick command substitution that would actually run on
    // every shell startup.
    assert.doesNotMatch(content, /\$\([^)]*security find-generic-password/)
    assert.doesNotMatch(content, /`[^`]*security find-generic-password/)
    // Preserves existing content.
    assert.match(content, /existing/)
    assert.match(content, /export PATH/)
  }),
)

test(
  'second run with same token returns outcome=unchanged',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '')
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    installShellRcBridge(FAKE_TOKEN)
    const r = installShellRcBridge(FAKE_TOKEN)
    assert.ok(r)
    assert.equal(r.outcome, 'unchanged')
  }),
)

test(
  'second run with a different token rewrites the block (rotation)',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '')
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    installShellRcBridge(FAKE_TOKEN)
    const rotated = `${FAKE_TOKEN}-rotated`
    const r = installShellRcBridge(rotated)
    assert.ok(r)
    assert.equal(r.outcome, 'updated')
    const content = readFileSync(rcPath, 'utf8')
    // Only one block.
    const beginCount = (content.match(/BEGIN socket-cli env/g) || []).length
    assert.equal(beginCount, 1)
    // New token is present; old is gone.
    assert.match(content, new RegExp(`export SOCKET_API_TOKEN='${rotated}'`))
    assert.doesNotMatch(
      content,
      new RegExp(`export SOCKET_API_TOKEN='${FAKE_TOKEN}'(?!-rotated)`),
    )
  }),
)

test(
  'tampered block body is rewritten in place (no duplicate append)',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '')
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    installShellRcBridge(FAKE_TOKEN)
    const tampered = readFileSync(rcPath, 'utf8').replace(
      `export SOCKET_API_KEY='${FAKE_TOKEN}'`,
      "export SOCKET_API_KEY='junk'",
    )
    writeFileSync(rcPath, tampered)
    const r = installShellRcBridge(FAKE_TOKEN)
    assert.ok(r)
    assert.equal(r.outcome, 'updated')
    const content = readFileSync(rcPath, 'utf8')
    const beginCount = (content.match(/BEGIN socket-cli env/g) || []).length
    assert.equal(beginCount, 1)
    assert.match(
      content,
      new RegExp(`export SOCKET_API_KEY='${FAKE_TOKEN}'`),
    )
    assert.doesNotMatch(content, /export SOCKET_API_KEY='junk'/)
  }),
)

test(
  'tokens with single quotes are escaped safely',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '')
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    // Hypothetical token with a single quote in it. Not a real shape,
    // but the escape logic should survive any byte sequence.
    const weird = "sk-test-with'quote"
    installShellRcBridge(weird)
    const content = readFileSync(rcPath, 'utf8')
    // Single-quote-close, escaped-quote, single-quote-reopen.
    assert.match(
      content,
      /export SOCKET_API_TOKEN='sk-test-with'\\''quote'/,
    )
  }),
)

test(
  'rejects empty / non-string token',
  withFakeHome(async () => {
    if (!IS_MACOS) {
      return
    }
    const { installShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    assert.throws(() => installShellRcBridge(''), /non-empty string/)
    assert.throws(
      // @ts-expect-error: deliberately wrong type
      () => installShellRcBridge(undefined),
      /non-empty string/,
    )
  }),
)

test(
  'uninstallShellRcBridge removes the block and preserves surrounding content',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '# before\nexport PATH=$PATH:/foo\n')
    const { installShellRcBridge, uninstallShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    installShellRcBridge(FAKE_TOKEN)
    const removed = uninstallShellRcBridge()
    assert.equal(removed, true)
    const content = readFileSync(rcPath, 'utf8')
    assert.doesNotMatch(content, /BEGIN socket-cli env/)
    assert.match(content, /# before/)
    assert.match(content, /export PATH/)
  }),
)

test(
  'uninstallShellRcBridge returns false when no block is present',
  withFakeHome(async rcPath => {
    if (!IS_MACOS) {
      return
    }
    writeFileSync(rcPath, '# nothing here\n')
    const { uninstallShellRcBridge } = await import(
      '../lib/shell-rc-bridge.mts'
    )
    assert.equal(uninstallShellRcBridge(), false)
    assert.ok(existsSync(rcPath))
  }),
)
