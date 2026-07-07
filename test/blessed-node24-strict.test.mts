import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

// Regression for Node 24 compatibility: blessed's lib/tput.js used octal escape
// sequences ('\200', '\016', '\017') that throw "Octal escape sequences are not
// allowed in strict mode" when the CLI's strict/bundled output loads it, so the
// CLI crashed on startup under Node 24. The blessed pnpm patch rewrites them as
// hex escapes. This guards that the shipped tput.js stays strict-mode-safe.
describe('blessed Node 24 compatibility', () => {
  it('lib/tput.js parses under strict mode', () => {
    const source = readFileSync(require.resolve('blessed/lib/tput.js'), 'utf8')
    // Compiles (does not execute) the module in strict mode via the Function
    // constructor, surfacing octal-escape syntax errors the same way Node 24
    // does at load time.
    expect(() => Function(`"use strict";\n${source}`)).not.toThrow()
  })
})
