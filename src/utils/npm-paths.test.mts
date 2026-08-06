import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveBinPathToJsEntry } from './npm-paths.mts'

// A bash wrapper of the shape mise writes so it can run `mise reshim` after a
// global install. It carries none of the `NPM_CLI_JS=` markers npm's own shim
// uses, so bin resolution hands it back untouched.
const MISE_NPM_WRAPPER = `#!/usr/bin/env bash
set -euo pipefail

this_dir=$(dirname "\${BASH_SOURCE[0]}")
exec npm "$@"
`

describe('resolveBinPathToJsEntry', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'socket-npm-paths-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true })
  })

  // Build the layout mise installs Node into:
  //   <root>/bin/npm                          (bash wrapper)
  //   <root>/lib/node_modules/npm/bin/npm-cli.js
  function createMiseLayout(
    options: { cliEntryNames?: string[] | undefined } = {},
  ): { binPath: string; npmBinDir: string } {
    const { cliEntryNames = ['npm-cli.js', 'npx-cli.js'] } = options
    const binDir = path.join(tmpDir, 'bin')
    const npmDir = path.join(tmpDir, 'lib', 'node_modules', 'npm')
    const npmBinDir = path.join(npmDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(npmBinDir, { recursive: true })
    // findNpmDirPathSync only accepts a directory that carries its own
    // node_modules, which a real npm install always has.
    mkdirSync(path.join(npmDir, 'node_modules'), { recursive: true })
    const binPath = path.join(binDir, 'npm')
    writeFileSync(binPath, MISE_NPM_WRAPPER, 'utf8')
    for (const cliEntryName of cliEntryNames) {
      writeFileSync(
        path.join(npmBinDir, cliEntryName),
        '#!/usr/bin/env node\n',
        'utf8',
      )
    }
    return { binPath, npmBinDir }
  }

  it("maps mise's bash npm wrapper to npm's JavaScript entry (issue #946)", () => {
    const { binPath, npmBinDir } = createMiseLayout()

    expect(resolveBinPathToJsEntry(binPath, 'npm-cli.js')).toBe(
      path.join(npmBinDir, 'npm-cli.js'),
    )
  })

  it('maps the npx wrapper to npx-cli.js', () => {
    const { binPath, npmBinDir } = createMiseLayout()

    expect(resolveBinPathToJsEntry(binPath, 'npx-cli.js')).toBe(
      path.join(npmBinDir, 'npx-cli.js'),
    )
  })

  it('leaves an already resolved JavaScript entry alone', () => {
    const { npmBinDir } = createMiseLayout()
    const jsEntryPath = path.join(npmBinDir, 'npm-cli.js')

    expect(resolveBinPathToJsEntry(jsEntryPath, 'npm-cli.js')).toBe(jsEntryPath)
  })

  it('returns the input when the install directory has no matching entry', () => {
    const { binPath } = createMiseLayout({ cliEntryNames: [] })

    expect(resolveBinPathToJsEntry(binPath, 'npm-cli.js')).toBe(binPath)
  })

  it('returns the input when no npm install directory can be found', () => {
    const strayDir = path.join(tmpDir, 'stray')
    mkdirSync(strayDir, { recursive: true })
    const binPath = path.join(strayDir, 'npm')
    writeFileSync(binPath, MISE_NPM_WRAPPER, 'utf8')

    expect(resolveBinPathToJsEntry(binPath, 'npm-cli.js')).toBe(binPath)
  })
})
