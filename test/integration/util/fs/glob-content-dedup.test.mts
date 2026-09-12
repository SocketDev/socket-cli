import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import v8 from 'node:v8'

import { describe, expect, it } from 'vitest'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { globWithGitIgnore } from '../../../../src/util/fs/glob.mts'

function codeSpaceMb(): number {
  const spaces = v8.getHeapSpaceStatistics()
  const used = (name: string) =>
    spaces.find(s => s.space_name === name)?.space_used_size ?? 0
  return (used('code_space') + used('code_large_object_space')) / 1_048_576
}

function jsonFilter(filepath: string): boolean {
  return filepath.endsWith('.json')
}

// Regression for the gitignore matcher OOM: flattening every nested .gitignore
// into one anchored `ignore` instance compiled one regex per (file x line) and
// exhausted V8 code space (~250-300MB) mid-scan, aborting `socket fix`. Per-dir
// matchers cached by content compile each distinct .gitignore once, so a repo of
// N packages sharing one boilerplate .gitignore stays flat regardless of N.
describe('globWithGitIgnore() large-monorepo gitignore memory', () => {
  it('stays within code-space and honors gitignores on a huge repeated set', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-dedup-'))
    try {
      // 300 packages x 1000 lines = 300k nominal patterns. The pre-fix anchored
      // global matcher compiles all 300k and crosses the code-space cliff; the
      // content-deduped matcher compiles the single boilerplate body once.
      const pkgCount = 300
      const linesPerPkg = 1000
      // A '!' negation: pre-fix this forced the slow `ignore`-package path that
      // OOM'd. The body is byte-identical across packages so they share one
      // compiled matcher.
      const lines: string[] = []
      for (let l = 0; l < linesPerPkg; l += 1) {
        lines.push(`generated_${l}/`)
      }
      lines.push('!keep.log')
      const gitignoreBody = `${lines.join('\n')}\n`

      writeFileSync(path.join(root, 'package.json'), '{}')
      const expected = [normalizePath(path.join(root, 'package.json'))]
      for (let d = 0; d < pkgCount; d += 1) {
        const pkgDir = path.join(root, 'packages', `pkg-${d}`)
        const ignoredDir = path.join(pkgDir, 'generated_0')
        mkdirSync(ignoredDir, { recursive: true })
        writeFileSync(path.join(pkgDir, '.gitignore'), gitignoreBody)
        writeFileSync(path.join(pkgDir, 'package.json'), '{}')
        // A manifest inside the package's own gitignored dir must be excluded,
        // proving the per-dir matcher still applies.
        writeFileSync(path.join(ignoredDir, 'package.json'), '{}')
        expected.push(normalizePath(path.join(pkgDir, 'package.json')))
      }

      const before = codeSpaceMb()
      // Mirror the production call: a manifest filter forces the streaming path.
      const results = await globWithGitIgnore(['**/*'], {
        cwd: root,
        filter: jsonFilter,
      })
      const after = codeSpaceMb()

      // Correctness: every package manifest found, every gitignored manifest skipped.
      expect(results.map(normalizePath).toSorted()).toEqual(expected.toSorted())
      // Memory: 300k nominal patterns collapse to one compiled matcher, so the
      // walk stays far below the ~250MB code-space cliff that aborted the scan.
      expect(after - before).toBeLessThan(80)
    } finally {
      safeDeleteSync(root)
    }
  })
})
