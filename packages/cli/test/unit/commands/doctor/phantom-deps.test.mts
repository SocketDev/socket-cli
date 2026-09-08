import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { classify } from '../../../../src/commands/doctor/phantom-deps/classify.mts'
import { extract } from '../../../../src/commands/doctor/phantom-deps/extract.mts'
import { walk } from '../../../../src/commands/doctor/phantom-deps/graph.mts'
import { parseManifest } from '../../../../src/commands/doctor/phantom-deps/manifest.mts'
import { scanPhantomDependencies } from '../../../../src/commands/doctor/phantom-deps/scan.mts'
import { classifySpecifier } from '../../../../src/commands/doctor/phantom-deps/specifier.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('phantom-deps/extract', () => {
  it('marks a type-only import typeOnly', () => {
    const occurrences = extract(
      'file.mts',
      `import type { Program } from 'typescript'\n`,
    )
    expect(occurrences).toEqual([
      { spec: 'typescript', soft: false, typeOnly: true },
    ])
  })

  it('marks a require inside a try block soft', () => {
    const occurrences = extract(
      'file.mts',
      `try { require('optional-thing') } catch {}\n`,
    )
    expect(occurrences).toEqual([
      { spec: 'optional-thing', soft: true, typeOnly: false },
    ])
  })

  it('marks a runtime import as neither soft nor typeOnly', () => {
    const occurrences = extract('file.mts', `import { z } from 'zod'\n`)
    expect(occurrences).toEqual([{ spec: 'zod', soft: false, typeOnly: false }])
  })
})

describe('phantom-deps/specifier', () => {
  it('classifies a relative specifier', () => {
    expect(classifySpecifier('./widgets.js').kind).toBe('relative')
  })

  it('classifies a bare package specifier', () => {
    const result = classifySpecifier('@scope/pkg/subpath')
    expect(result.kind).toBe('bare')
    expect(result).toMatchObject({ packageName: '@scope/pkg' })
  })

  it('classifies a Node builtin as other', () => {
    expect(classifySpecifier('node:fs').kind).toBe('other')
  })
})

describe('phantom-deps/classify', () => {
  const manifest = parseManifest(
    JSON.stringify({
      name: 'example-pkg',
      dependencies: { zod: '^3.0.0' },
    }),
  )!

  it('classifies a reference reachable only from the type surface as type-only, never hard-phantom', () => {
    // Regression: pnpm#13970 / pnpm#14128 - a type-only reference into a
    // self-typed package (no separate @types/<pkg> twin exists) must never
    // classify as a phantom just because no types twin was declared.
    const findings = classify(manifest, [
      {
        package: 'typescript',
        raw: 'typescript',
        soft: false,
        fromMain: false,
        fromSubpath: false,
        fromTypes: true,
      },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.verdict).toBe('type-only')
  })

  it('classifies an undeclared runtime reference from main as hard-phantom', () => {
    const findings = classify(manifest, [
      {
        package: 'lodash',
        raw: 'lodash',
        soft: false,
        fromMain: true,
        fromSubpath: false,
        fromTypes: false,
      },
    ])
    expect(findings[0]?.verdict).toBe('hard-phantom')
  })

  it('classifies a declared dependency as declared', () => {
    const findings = classify(manifest, [
      {
        package: 'zod',
        raw: 'zod',
        soft: false,
        fromMain: true,
        fromSubpath: false,
        fromTypes: false,
      },
    ])
    expect(findings[0]?.verdict).toBe('declared')
  })

  it('classifies a self-reference as self-ref', () => {
    const findings = classify(manifest, [
      {
        package: 'example-pkg',
        raw: 'example-pkg',
        soft: false,
        fromMain: true,
        fromSubpath: false,
        fromTypes: false,
      },
    ])
    expect(findings[0]?.verdict).toBe('self-ref')
  })

  it('classifies an all-soft (try-guarded) reference as soft-phantom', () => {
    const findings = classify(manifest, [
      {
        package: 'optional-thing',
        raw: 'optional-thing',
        soft: true,
        fromMain: true,
        fromSubpath: false,
        fromTypes: false,
      },
    ])
    expect(findings[0]?.verdict).toBe('soft-phantom')
  })
})

describe('phantom-deps end to end', () => {
  it('walks a fixture package and finds a hard phantom, but never a type-only one', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'phantom-deps-'))
    try {
      writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: 'fixture-pkg',
          main: 'index.js',
          types: 'index.d.ts',
        }),
      )
      writeFileSync(
        path.join(dir, 'index.js'),
        `const lodash = require('lodash')\nmodule.exports = lodash\n`,
      )
      writeFileSync(
        path.join(dir, 'index.d.ts'),
        `import type { Program } from 'typescript'\nexport declare const lodash: Program\n`,
      )

      const manifest = parseManifest(
        readFileSync(path.join(dir, 'package.json'), 'utf8'),
      )!
      const walked = walk(dir, manifest.entryPoints)
      const findings = classify(manifest, walked.references)

      const lodashFinding = findings.find(f => f.package === 'lodash')
      const typescriptFinding = findings.find(f => f.package === 'typescript')

      expect(lodashFinding?.verdict).toBe('hard-phantom')
      expect(typescriptFinding?.verdict).toBe('type-only')
    } finally {
      await safeDelete(dir)
    }
  })

  it('scanPhantomDependencies finds a hard phantom in an installed dependency', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'phantom-deps-root-'))
    try {
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'root-pkg',
          dependencies: { 'dep-with-phantom': '1.0.0' },
        }),
      )
      const depDir = path.join(root, 'node_modules', 'dep-with-phantom')
      mkdirSync(depDir, { recursive: true })
      writeFileSync(
        path.join(depDir, 'package.json'),
        JSON.stringify({ name: 'dep-with-phantom', main: 'index.js' }),
      )
      writeFileSync(
        path.join(depDir, 'index.js'),
        `module.exports = require('left-pad')\n`,
      )

      const findings = scanPhantomDependencies(root)
      expect(findings).toHaveLength(1)
      expect(findings[0]).toMatchObject({
        importer: 'dep-with-phantom',
        target: 'left-pad',
      })
    } finally {
      await safeDelete(root)
    }
  })
})
