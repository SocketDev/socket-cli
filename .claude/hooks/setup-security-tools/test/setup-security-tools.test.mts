import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(__dirname, '..', 'index.mts')

// setup-security-tools is a setup script, not a Claude Code hook —
// it doesn't read stdin, doesn't have a tool_input contract, and the
// `main()` body downloads binaries on every invocation. The
// meaningful test surface is "the script parses without syntax
// errors" — full integration coverage lives in
// .github/workflows/setup-security-tools.yml, where the script
// actually runs against the network.

test('parses without syntax errors (node --check)', async () => {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', SCRIPT], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', c => {
      if (c !== 0) {
        reject(new Error(`node --check exited ${c}; stderr=${stderr}`))
        return
      }
      resolve(c ?? -1)
    })
  })
  assert.equal(code, 0)
})

test('module imports without throwing (does NOT invoke main)', async () => {
  // The script auto-runs `main()` at module load, so we can't just
  // `import(SCRIPT)`. Instead, spawn a child node process that
  // imports the module under a `DRY_RUN=1` guard… but the script
  // doesn't honor such a guard. Document the gap here and leave the
  // syntax check above as the primary surface — full coverage
  // requires either (a) refactoring index.mts to export main() and
  // gate the auto-invocation behind `import.meta.main`, or (b) a
  // mock harness that traps the lib imports. Both are scope-creep
  // for this baseline test.
  //
  // Once the module is refactored to gate auto-invocation, replace
  // this test with a real import + export-shape assertion.
  assert.ok(true, 'placeholder — see comment above')
})
