// node --test specs for the catch-message-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'catch-message-guard-test-'))
  const p = path.join(dir, name)
  writeFileSync(p, content)
  return p
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('non-JS/TS file passes', async () => {
  const p = tmpFile('config.yml', 'x: y\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'x: y\n# } catch (e) { ${e.message} }\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('introducing ${e.message} in catch (e) blocks', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (e) {\n  console.log(`bad: ${e.message}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /catch-message-guard.*Blocked/)
  assert.match(r.stderr, /e\.message/)
})

test('errorMessage(e) wrapper with catch (e) passes', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (e) {\n  console.log(`ok: ${errorMessage(e)}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('inline instanceof guard with catch (e) passes', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (e) {\n  const msg = e instanceof Error ? e.message : String(e)\n  console.log(`got: ${msg}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('catch (err) flagged as wrong binding name', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (err) {\n  logger.error(`got: ${errorMessage(err)}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /catch binding should be `e`/)
  assert.match(r.stderr, /catch \(err\)/)
})

test('catch (error) flagged as wrong binding name', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (error) {\n  logger.error(`got: ${errorMessage(error)}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /catch \(error\)/)
})

test('catch (err) with .message → both message AND binding flagged', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (err) {\n  logger.error(`bad: ${err.message}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /catch-message-guard/)
  assert.match(r.stderr, /catch binding should be `e`/)
})

test('per-line marker bypasses message', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (e) {\n  console.log(`bad: ${e.message}`) // ok: catch-message error is always Error here\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('per-line marker bypasses binding', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (err) { // ok: catch-binding cargo-cult name from upstream\n  logger.error(`ok: ${errorMessage(err)}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('test-tree file passes', async () => {
  const p = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'cmg-test-')),
    'test',
    'foo.test.mts',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'try {\n  doIt()\n} catch (e) {\n  console.log(`bad: ${e.message}`)\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('pre-existing message + binding violations not re-flagged', async () => {
  const before =
    'try {\n  doIt()\n} catch (err) {\n  console.log(`bad: ${err.message}`)\n}\n'
  const p = tmpFile('a.mts', before)
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: p,
      old_string: 'doIt()',
      new_string: 'doItTwice()',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('${err.message} outside catch passes', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'function describe(e: Error) {\n  return `error: ${e.message}`\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('catch (_) leading underscore is allowed (unused binding)', async () => {
  const p = tmpFile('a.mts', 'export {}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'try {\n  doIt()\n} catch (_) {\n  retry()\n}\n',
    },
  })
  assert.strictEqual(r.code, 0)
})
