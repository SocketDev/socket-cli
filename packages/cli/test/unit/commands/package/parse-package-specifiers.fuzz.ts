/**
 * @file Vitiate coverage-guided fuzz target (Tier 2) for
 *   src/commands/package/parse-package-specifiers — the untrusted-CLI-arg
 *   tokenizer that turns `<ecosystem> <pkg...>` into purls. Complements the
 *   fast-check property test in parse-package-specifiers.fuzz.test.mts:
 *   fast-check checks the contract on constructed arg shapes; vitiate feeds
 *   SWC-coverage-guided mutated BYTES (split into an ecosystem + package args)
 *   to drive the purl-detection branches. Contract, read from src:
 *   parsePackageSpecifiers is total — it returns `{ purls: string[]; valid:
 *   boolean }` and never throws on any input. Run via `pnpm run test:fuzz`.
 */

import { fuzz } from '@vitiate/core'

import { parsePackageSpecifiers } from '../../../../src/commands/package/parse-package-specifiers.mts'

fuzz(
  'parsePackageSpecifiers never throws and returns a well-formed result',
  data => {
    const lines = data.toString('utf8').split('\n')
    const ecosystem = lines[0] ?? ''
    // A fresh array each call — parsePackageSpecifiers mutates it (unshift).
    const pkgs = lines.slice(1)
    const result = parsePackageSpecifiers(ecosystem, pkgs)
    if (typeof result.valid !== 'boolean' || !Array.isArray(result.purls)) {
      throw new Error('parsePackageSpecifiers returned a malformed result')
    }
    for (let i = 0, { length } = result.purls; i < length; i += 1) {
      if (typeof result.purls[i] !== 'string') {
        throw new Error('parsePackageSpecifiers produced a non-string purl')
      }
    }
  },
)
