/**
 * @file Unit tests for the shared foreign-linter classifier — the single
 *   detection + `fleet.hostTestDeps` audit consumed by no-other-linters-guard
 *   (edit-time hook) and linters-are-oxlint-oxfmt-only (committed-state check).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  auditForeignDeps,
  commandWords,
  foreignToolBinary,
  isForeignConfigFile,
  isForeignToolPackage,
  isVendoredUpstream,
} from '../foreign-linters.mts'

// ── config files ────────────────────────────────────────────────

test('flags every foreign config shape', () => {
  for (const name of [
    'biome.json',
    'biome.jsonc',
    '.dprint.json',
    '.eslintrc',
    '.eslintrc.cjs',
    'eslint.config.mjs',
    '.prettierrc',
    '.prettierrc.yaml',
    'prettier.config.ts',
  ]) {
    assert.ok(isForeignConfigFile(name), name)
  }
})

test('passes fleet config files', () => {
  for (const name of ['oxlintrc.json', 'oxfmtrc.json', 'package.json']) {
    assert.ok(!isForeignConfigFile(name), name)
  }
})

// ── package families ────────────────────────────────────────────

test('flags exact + family package names', () => {
  for (const name of [
    '@biomejs/biome',
    'dprint',
    'eslint',
    'prettier',
    'rome',
    '@eslint/js',
    '@typescript-eslint/parser',
    'eslint-config-airbnb',
    'eslint-plugin-import',
    'prettier-plugin-tailwindcss',
    '@acme/eslint-shared',
  ]) {
    assert.ok(isForeignToolPackage(name), name)
  }
})

test('passes non-foreign names', () => {
  for (const name of ['oxlint', 'vitest', '@babel/core', 'rollup', 'unplugin']) {
    assert.ok(!isForeignToolPackage(name), name)
  }
})

test('maps package families to their CLI binary', () => {
  assert.strictEqual(foreignToolBinary('@biomejs/biome'), 'biome')
  assert.strictEqual(foreignToolBinary('dprint'), 'dprint')
  assert.strictEqual(foreignToolBinary('prettier-plugin-x'), 'prettier')
  assert.strictEqual(foreignToolBinary('rome'), 'rome')
  assert.strictEqual(foreignToolBinary('eslint'), 'eslint')
  assert.strictEqual(foreignToolBinary('@typescript-eslint/parser'), 'eslint')
})

// ── vendored upstream ───────────────────────────────────────────

test('vendored upstream paths are exempt', () => {
  assert.ok(isVendoredUpstream('upstream/acorn/package.json'))
  assert.ok(isVendoredUpstream('packages/xml/vendor/quick-xml/biome.json'))
  assert.ok(isVendoredUpstream('acorn-upstream/package.json'))
  assert.ok(!isVendoredUpstream('packages/acorn/package.json'))
})

// ── commandWords tokenizer ──────────────────────────────────────

test('head token of each segment is a command word', () => {
  assert.deepStrictEqual(commandWords('eslint . && vitest run'), [
    'eslint',
    'vitest',
  ])
})

test('env-var prefixes are skipped', () => {
  assert.deepStrictEqual(commandWords('CI=1 NODE_ENV=test eslint .'), [
    'eslint',
  ])
})

test('runner indirection surfaces the executed tool', () => {
  assert.deepStrictEqual(commandWords('npx eslint .'), ['npx', 'eslint'])
  assert.deepStrictEqual(commandWords('pnpm exec prettier --check .'), [
    'pnpm',
    'prettier',
  ])
  assert.deepStrictEqual(commandWords('yarn biome check'), ['yarn', 'biome'])
})

test('path-prefixed binaries reduce to their basename', () => {
  assert.deepStrictEqual(commandWords('node_modules/.bin/eslint src'), [
    'eslint',
  ])
})

test('a file-path ARGUMENT containing a tool name is not a command word', () => {
  assert.deepStrictEqual(
    commandWords('vitest run src/aqs-adapters/__tests__/to-eslint.test.ts'),
    ['vitest'],
  )
})

// ── auditForeignDeps: the fleet.hostTestDeps contract ───────────

function pkgJson(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

test('foreign dep with no fleet.hostTestDeps entry is blocked', () => {
  const audit = auditForeignDeps(
    pkgJson({ devDependencies: { eslint: '^9.0.0' } }),
  )
  assert.deepStrictEqual(audit.allowed, [])
  assert.strictEqual(audit.blocked.length, 1)
  assert.strictEqual(audit.blocked[0]!.name, 'eslint')
  assert.match(audit.blocked[0]!.reason, /not listed/)
})

test('listed host-test dep in devDependencies is allowed', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
    }),
  )
  assert.deepStrictEqual(audit.allowed, ['eslint'])
  assert.deepStrictEqual(audit.blocked, [])
})

test('listed host-test dep in peerDependencies is allowed', () => {
  const audit = auditForeignDeps(
    pkgJson({
      peerDependencies: { eslint: '>=9' },
      fleet: { hostTestDeps: ['eslint'] },
    }),
  )
  assert.deepStrictEqual(audit.allowed, ['eslint'])
  assert.deepStrictEqual(audit.blocked, [])
})

test('listed host-test dep in runtime dependencies is blocked', () => {
  const audit = auditForeignDeps(
    pkgJson({
      dependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
    }),
  )
  assert.strictEqual(audit.blocked.length, 1)
  assert.match(audit.blocked[0]!.reason, /devDependencies\/peerDependencies/)
})

test('listed host-test dep invoked by a script is blocked', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
      scripts: { lint: 'eslint src' },
    }),
  )
  assert.strictEqual(audit.blocked.length, 1)
  assert.match(audit.blocked[0]!.reason, /script `lint` invokes `eslint`/)
})

test('script invocation via runner indirection is caught', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
      scripts: { lint: 'pnpm exec eslint src' },
    }),
  )
  assert.strictEqual(audit.blocked.length, 1)
})

test('a test script whose ARGUMENT mentions the tool does not void the allowance', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
      scripts: {
        test: 'vitest run src/aqs-adapters/__tests__/to-eslint.test.ts',
      },
    }),
  )
  assert.deepStrictEqual(audit.allowed, ['eslint'])
  assert.deepStrictEqual(audit.blocked, [])
})

test('allowance is per-package: unlisted siblings stay blocked', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0', prettier: '^3.0.0' },
      fleet: { hostTestDeps: ['eslint'] },
    }),
  )
  assert.deepStrictEqual(audit.allowed, ['eslint'])
  assert.strictEqual(audit.blocked.length, 1)
  assert.strictEqual(audit.blocked[0]!.name, 'prettier')
})

test('eslint-family plugin listed alongside its host is allowed', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { 'eslint': '^9.0.0', '@eslint/js': '^9.0.0' },
      fleet: { hostTestDeps: ['eslint', '@eslint/js'] },
    }),
  )
  assert.deepStrictEqual(audit.allowed, ['@eslint/js', 'eslint'])
  assert.deepStrictEqual(audit.blocked, [])
})

test('malformed fleet.hostTestDeps (non-array) is ignored', () => {
  const audit = auditForeignDeps(
    pkgJson({
      devDependencies: { eslint: '^9.0.0' },
      fleet: { hostTestDeps: 'eslint' },
    }),
  )
  assert.strictEqual(audit.blocked.length, 1)
})

test('malformed JSON fails open (empty audit)', () => {
  const audit = auditForeignDeps('{ not json')
  assert.deepStrictEqual(audit, { allowed: [], blocked: [] })
})

test('clean package.json yields an empty audit', () => {
  const audit = auditForeignDeps(
    pkgJson({ devDependencies: { oxlint: '1.0.0', vitest: '3.0.0' } }),
  )
  assert.deepStrictEqual(audit, { allowed: [], blocked: [] })
})
