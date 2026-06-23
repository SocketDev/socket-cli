import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import { globWithGitIgnore } from './glob.mts'

// Defined at module scope to satisfy linting rules.
function filterJsonFiles(filepath: string): boolean {
  return filepath.endsWith('.json')
}

// This suite lives in its own file, with no mock-fs node_modules preload, so the
// large ignore set it builds is the only significant allocation in the worker.
describe('globWithGitIgnore() large monorepo memory', () => {
  // Regression: scanning a large monorepo OOM'd because the whole unioned
  // gitignore set was handed to fast-glob, which recompiled it per directory
  // scan. The 100k-pattern tree below crashes the pre-fix path; the walk must
  // complete with the right manifests. Real fs (mock-fs is too heavy here).
  it('does not exhaust memory on a huge nested-.gitignore pattern set', async () => {
    const realTmp = mkdtempSync(path.join(tmpdir(), 'socket-glob-oom-'))
    try {
      // 100 packages * 1000 lines = 100k distinct patterns. The pre-fix code
      // (whole set handed to fast-glob, re-compiled per directory scan) exhausts
      // a constrained test-worker heap at this count, while the reused `ignore`
      // instance stays well within it.
      const pkgCount = 100
      const linesPerPkg = 1_000
      // Each line anchors to a distinct local generated dir, so the flat union
      // across packages is pkgCount * linesPerPkg distinct patterns.
      const lines: string[] = []
      for (let l = 0; l < linesPerPkg; l += 1) {
        lines.push(`generated_${l}/`)
      }
      const gitignoreBody = `${lines.join('\n')}\n`
      // The root manifest and one manifest per package must be found.
      writeFileSync(path.join(realTmp, 'package.json'), '{}')
      const expected = [normalizePath(path.join(realTmp, 'package.json'))]
      for (let d = 0; d < pkgCount; d += 1) {
        const pkgDir = path.join(realTmp, 'packages', `pkg-${d}`)
        const ignoredDir = path.join(pkgDir, 'generated_0')
        mkdirSync(ignoredDir, { recursive: true })
        writeFileSync(path.join(pkgDir, '.gitignore'), gitignoreBody)
        writeFileSync(path.join(pkgDir, 'package.json'), '{}')
        // A manifest inside the package's own ignored generated dir must be
        // excluded, proving the gitignore set is still honored.
        writeFileSync(path.join(ignoredDir, 'package.json'), '{}')
        expected.push(normalizePath(path.join(pkgDir, 'package.json')))
      }

      // Mirror the production call shape: a manifest filter forces the streaming
      // branch that getPackageFilesForScan always takes.
      const results = await globWithGitIgnore(['**/*'], {
        cwd: realTmp,
        filter: filterJsonFiles,
      })

      expect(results.map(normalizePath).sort()).toEqual(expected.sort())
    } finally {
      rmSync(realTmp, { force: true, recursive: true })
    }
  }, 60_000)
})
