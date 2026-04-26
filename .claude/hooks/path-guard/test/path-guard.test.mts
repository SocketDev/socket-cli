// Tests for the path-guard hook. Each `node:test` block writes a
// mock PreToolUse payload to the hook's stdin and asserts on its exit
// code + stderr. Exit 2 = blocked; exit 0 = allowed.
//
// Run: pnpm --filter @socketsecurity/hook-path-guard test
//      (or directly: node --test test/*.test.mts)

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const HOOK = path.resolve(__dirname, '..', 'index.mts')

const runHook = (
  toolName: string,
  filePath: string,
  source: string,
): { code: number; stderr: string } => {
  const payload = JSON.stringify({
    tool_name: toolName,
    tool_input:
      toolName === 'Edit'
        ? { file_path: filePath, new_string: source }
        : { file_path: filePath, content: source },
  })
  const result = spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: payload,
  })
  return {
    code: result.status ?? -1,
    stderr: result.stderr,
  }
}

describe('path-guard — Rule A (multi-stage construction)', () => {
  it('blocks two stage segments in path.join', () => {
    const source = `
      const p = path.join(PACKAGE_ROOT, 'wasm', 'out', 'Final', 'bin')
    `
    const { code, stderr } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
    assert.match(stderr, /Blocked: A/)
    assert.match(stderr, /1 path, 1 reference/)
  })

  it('blocks build + mode + stage', () => {
    const source = `
      const p = path.join(PKG, 'build', 'dev', 'out', 'Final', 'binary')
    `
    const { code } = runHook(
      'Edit',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('blocks Release + Stripped together', () => {
    const source = `
      const p = path.join(buildDir, 'Release', 'Stripped')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/release.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('allows single stage segment with one build root', () => {
    // 'build' + 'temp' → no stage segment at all → pass
    const source = `
      const tmp = path.join(packageRoot, 'build', 'temp')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('allows path.join with no stage segments', () => {
    const source = `
      const cfg = path.join(packageRoot, 'config', 'settings.json')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })
})

describe('path-guard — Rule B (cross-package traversal)', () => {
  it('blocks .. + sibling package + build context', () => {
    const source = `
      const lief = path.join(PKG, '..', 'lief-builder', 'build', 'Final')
    `
    const { code, stderr } = runHook(
      'Write',
      'packages/binject/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
    assert.match(stderr, /Blocked: B/)
    assert.match(stderr, /lief-builder/)
  })

  it('allows .. + sibling without build context', () => {
    // Reaching into a sibling for a non-build asset is allowed; the
    // gate may still flag it but the hook is scoped to build paths.
    const source = `
      const cfg = path.join(PKG, '..', 'lief-builder', 'config.json')
    `
    const { code } = runHook(
      'Write',
      'packages/binject/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('does not fire on traversal to unknown directory', () => {
    const source = `
      const x = path.join(PKG, '..', 'fixtures', 'build', 'Final')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/test/test.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('does not fire when .. and sibling are non-adjacent (regression)', () => {
    // Earlier regex ran with sticky sawDotDot — once it saw `..` it
    // would flag any later sibling-named segment. The fix requires
    // the sibling to appear *immediately* after `..`.
    const source = `
      const x = path.join(PKG, '..', 'cache', 'lief-builder', 'config.json')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })
})

describe('path-guard — paren-balance correctness', () => {
  it('detects A through nested function-call args (regression)', () => {
    // Old regex used \\([^()]*\\) which only handled one nesting
    // level — `path.join(getDir(child(x)), 'build', 'dev', 'Final')`
    // silently slipped through. The paren-balancing scanner catches it.
    const source = `
      const p = path.join(getDir(child(x)), 'build', 'dev', 'out', 'Final')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('detects A in path.resolve() too', () => {
    const source = `
      const p = path.resolve(PKG, 'build', 'dev', 'out', 'Final', 'bin')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })
})

describe('path-guard — template literals', () => {
  it('detects A in fully-literal template path', () => {
    const source = '\n      const p = `build/dev/out/Final/binary`\n    '
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('detects A in template with placeholders', () => {
    const source =
      '\n      const p = `${PKG}/build/${mode}/${arch}/out/Final/${name}`\n    '
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('allows template with single non-stage segment', () => {
    const source = '\n      const url = `https://example.com/path`\n    '
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('allows template with no stage segments', () => {
    const source = '\n      const tmp = `${packageRoot}/build/temp/cache`\n    '
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('allows template that is purely interpolation', () => {
    // `${a}/${b}/${c}` has no literal stage segments.
    const source = '\n      const p = `${a}/${b}/${c}`\n    '
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 0)
  })
})

describe('path-guard — file-type filter', () => {
  it('skips .ts files', () => {
    const source = `
      const p = path.join(PKG, 'build', 'dev', 'out', 'Final', 'bin')
    `
    const { code } = runHook('Write', 'packages/foo/src/index.ts', source)
    assert.equal(code, 0)
  })

  it('skips .mjs files', () => {
    const source = `
      const p = path.join(PKG, 'build', 'dev', 'out', 'Final', 'bin')
    `
    const { code } = runHook('Write', 'additions/foo.mjs', source)
    assert.equal(code, 0)
  })

  it('skips .yml files', () => {
    const source = `
      run: |
        FINAL="build/\${MODE}/\${ARCH}/out/Final"
    `
    const { code } = runHook(
      'Write',
      '.github/workflows/foo.yml',
      source,
    )
    assert.equal(code, 0)
  })

  it('inspects .mts files', () => {
    const source = `
      const p = path.join(PKG, 'build', 'dev', 'out', 'Final', 'bin')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.mts',
      source,
    )
    assert.equal(code, 2)
  })

  it('inspects .cts files', () => {
    const source = `
      const p = path.join(PKG, 'build', 'dev', 'out', 'Final', 'bin')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/build.cts',
      source,
    )
    assert.equal(code, 2)
  })
})

describe('path-guard — exempt files', () => {
  it('allows edits to paths.mts', () => {
    const source = `
      export const FINAL_DIR = path.join(PKG, 'build', 'dev', 'out', 'Final')
    `
    const { code } = runHook(
      'Write',
      'packages/foo/scripts/paths.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('allows edits to check-paths.mts (the gate)', () => {
    const source = `
      const PATTERNS = [path.join('build', 'Final', 'wasm')]
    `
    const { code } = runHook('Write', 'scripts/check-paths.mts', source)
    assert.equal(code, 0)
  })

  it('allows edits to the path-guard hook itself', () => {
    const source = `
      const STAGES = ['Final', 'Release', 'Stripped']
    `
    const { code } = runHook(
      'Write',
      '.claude/hooks/path-guard/index.mts',
      source,
    )
    assert.equal(code, 0)
  })

  it('allows edits to path-guard tests', () => {
    const source = `
      const fixture = path.join('build', 'dev', 'out', 'Final')
    `
    const { code } = runHook(
      'Write',
      '.claude/hooks/path-guard/test/path-guard.test.mts',
      source,
    )
    assert.equal(code, 0)
  })
})

describe('path-guard — tool-name filter', () => {
  it('skips Bash', () => {
    const source = `path.join(PKG, 'build', 'dev', 'out', 'Final', 'bin')`
    const { code } = runHook('Bash', '', source)
    assert.equal(code, 0)
  })

  it('skips Read', () => {
    const source = ''
    const { code } = runHook('Read', 'packages/foo/scripts/build.mts', source)
    assert.equal(code, 0)
  })
})

describe('path-guard — bug-tolerance (fails open)', () => {
  it('passes through invalid JSON payload', () => {
    const result = spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      input: 'not json at all',
    })
    assert.equal(result.status, 0)
  })

  it('passes through empty stdin', () => {
    const result = spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      input: '',
    })
    assert.equal(result.status, 0)
  })
})
