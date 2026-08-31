/**
 * Guards that nothing under external/ reaches for a bundled package by bare
 * name. Node resolves bare specifiers only through node_modules directories,
 * and external/ is not one, so such a require throws "Cannot find module" in
 * the published package even though the file ships correctly on disk.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const externalPath = path.join(rootPath, 'external')

// Mirrors EXTERNAL_PACKAGES in .config/rollup.base.config.mjs. Scoped to what
// the build vendors into external/, because unbundled optional peers reached by
// bare name there (blessed's pty.js/term.js terminal widget, node-gyp under
// @socketsecurity/registry) are a separate, longstanding question.
const bundledNames = new Set([
  '@socketsecurity/registry',
  'blessed',
  'blessed-contrib',
])

const bareRequireRegExp =
  /require[$\w]*(?:\.resolve)?\(\s*['"]([^'"]+)['"]\s*\)/g

function findScripts(dirPath: string): string[] {
  const scriptPaths: string[] = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      scriptPaths.push(...findScripts(entryPath))
    } else if (entry.name.endsWith('.js')) {
      scriptPaths.push(entryPath)
    }
  }
  return scriptPaths.sort()
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:') ||
    path.isAbsolute(specifier)
  ) {
    return undefined
  }
  const segments = specifier.split('/')
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0]
}

describe('external bare requires', () => {
  it('never name a bundled package', () => {
    if (!existsSync(externalPath)) {
      throw new Error(
        `Missing build output at ${externalPath}.\n` +
          `→ This test checks what ships, so it needs a built external/.\n` +
          `→ Run: pnpm build:dist:src`,
      )
    }
    const scriptPaths = findScripts(externalPath)
    expect(scriptPaths.length).toBeGreaterThan(0)

    const findings: string[] = []
    for (const scriptPath of scriptPaths) {
      const relPath = path.relative(rootPath, scriptPath).replace(/\\/g, '/')
      const source = readFileSync(scriptPath, 'utf8')
      bareRequireRegExp.lastIndex = 0
      let match
      while ((match = bareRequireRegExp.exec(source)) !== null) {
        const specifier = match[1]!
        const pkgName = packageNameFromSpecifier(specifier)
        if (!pkgName || !bundledNames.has(pkgName)) {
          continue
        }
        const finding = `${relPath} requires "${specifier}"`
        if (!findings.includes(finding)) {
          findings.push(finding)
        }
      }
    }

    expect(findings).toEqual([])
  })
})
