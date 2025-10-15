/**
 * Pre-build transform for meow package.
 * Converts dependencies.js from ESM to CommonJS to prevent rollup commonjs plugin issues.
 */

import {
  promises as fs,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

/**
 * Find meow package directory dynamically.
 */
function findMeowDir() {
  const pnpmDir = join(rootDir, 'node_modules/.pnpm')
  const dirs = readdirSync(pnpmDir)
  const meowDir = dirs.find(d => d.startsWith('meow@'))
  if (!meowDir) {
    throw new Error('Could not find meow package in node_modules/.pnpm')
  }
  return join(pnpmDir, meowDir, 'node_modules/meow')
}

// Find meow's build directory in node_modules.
const meowDir = findMeowDir()
const meowBuildDir = join(meowDir, 'build')

/**
 * Convert ESM imports to CommonJS requires.
 */
function convertImportsToCjs(code) {
  // Convert: import { a as x, b as y } from 'module'
  // To: const require$$temp = require('module'); const x = require$$temp.a; const y = require$$temp.b
  code = code.replace(
    /^import\s+\{\s*([^}]+)\s*\}\s+from\s+(['"][^'"]+['"])/gm,
    (_match, imports, modulePath) => {
      const tempVar = `require$$temp${Math.random().toString(36).slice(2, 8)}`
      const parts = imports.split(',').map(s => s.trim())
      const assignments = parts.map(part => {
        const asMatch = part.match(/^(\S+)\s+as\s+(\S+)$/)
        if (asMatch) {
          return `const ${asMatch[2]} = ${tempVar}.${asMatch[1]}`
        }
        return `const ${part} = ${tempVar}.${part}`
      })
      return `const ${tempVar} = require(${modulePath}); ${assignments.join('; ')}`
    },
  )

  // Convert: import defaultExport, { named } from 'module'
  // To: const require$$default = require('module'); const defaultExport = require$$default; const named = require$$default.named
  code = code.replace(
    /^import\s+([^,\s{]+)\s*,\s*\{\s*([^}]+)\s*\}\s+from\s+(['"][^'"]+['"])/gm,
    (_match, defaultName, namedImports, modulePath) => {
      const tempVar = `require$$temp${Math.random().toString(36).slice(2, 8)}`
      const parts = namedImports.split(',').map(s => s.trim())
      const assignments = parts.map(part => {
        const asMatch = part.match(/^(\S+)\s+as\s+(\S+)$/)
        if (asMatch) {
          return `const ${asMatch[2]} = ${tempVar}.${asMatch[1]}`
        }
        return `const ${part} = ${tempVar}.${part}`
      })
      return `const ${tempVar} = require(${modulePath}); const ${defaultName} = ${tempVar}; ${assignments.join('; ')}`
    },
  )

  // Convert: import defaultExport from 'module'
  // To: const defaultExport = require('module')
  code = code.replace(
    /^import\s+([^{}\s]+)\s+from\s+(['"][^'"]+['"])/gm,
    'const $1 = require($2)',
  )

  return code
}

/**
 * Convert ESM exports to CommonJS exports.
 */
function convertExportsToCjs(code) {
  // Convert: export { a as x, b as y, c as z }
  // To: module.exports = { x: a, y: b, z: c }
  code = code.replace(
    /^export\s+\{\s*([^}]+)\s*\}\s*;?\s*$/gm,
    (_match, exports) => {
      // Parse the exports: "a as x, b as y, c as z"
      const exportPairs = exports.split(',').map(e => e.trim())
      const mappings = exportPairs.map(pair => {
        const parts = pair.split(/\s+as\s+/)
        if (parts.length === 2) {
          return `${parts[1]}: ${parts[0]}`
        }
        return `${pair}: ${pair}`
      })
      return `module.exports = { ${mappings.join(', ')} };`
    },
  )

  // Convert: export const x = ...
  // To: const x = ...; exports.x = x
  code = code.replace(/^export\s+(const|let|var)\s+(\w+)/gm, '$1 $2')

  // Fix default export for ESM interop.
  // Convert: module.exports = { default: foo }
  // To: module.exports = foo; module.exports.default = foo
  code = code.replace(
    /^module\.exports\s*=\s*\{\s*default:\s*(\w+)\s*\}\s*;?\s*$/gm,
    'module.exports = $1; module.exports.default = $1;',
  )

  return code
}

try {
  // Clean dist directory first.
  const distDir = join(rootDir, 'dist')
  await fs.rm(distDir, { recursive: true, force: true })
  console.log('✓ Cleaned dist directory')

  // Update meow's package.json to mark it as CommonJS.
  const meowPackageJsonPath = join(meowDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(meowPackageJsonPath, 'utf-8'))
  packageJson.type = 'commonjs'
  writeFileSync(
    meowPackageJsonPath,
    JSON.stringify(packageJson, null, 2),
    'utf-8',
  )
  console.log('✓ Changed meow package.json type to commonjs')

  const dependenciesPath = join(meowBuildDir, 'dependencies.js')
  let code = readFileSync(dependenciesPath, 'utf-8')

  // Convert ESM to CommonJS.
  code = convertImportsToCjs(code)
  code = convertExportsToCjs(code)

  // Write back to dependencies.js as CommonJS.
  writeFileSync(dependenciesPath, code, 'utf-8')

  console.log('✓ Converted dependencies.js from ESM to CommonJS')

  // Now convert other meow files to CommonJS as well.
  const files = readdirSync(meowBuildDir).filter(
    f => f.endsWith('.js') && f !== 'dependencies.js',
  )

  let updatedCount = 0
  for (const file of files) {
    const filePath = join(meowBuildDir, file)
    let fileCode = readFileSync(filePath, 'utf-8')
    const original = fileCode

    // Convert ALL ESM imports to CommonJS.
    fileCode = convertImportsToCjs(fileCode)

    // Convert ALL ESM exports to CommonJS.
    fileCode = convertExportsToCjs(fileCode)

    if (fileCode !== original) {
      writeFileSync(filePath, fileCode, 'utf-8')
      updatedCount++
    }
  }

  if (updatedCount > 0) {
    console.log(`✓ Converted ${updatedCount} meow files to CommonJS`)
  }
} catch (error) {
  console.error('Failed to transform meow:', error.message)
  process.exit(1)
}
