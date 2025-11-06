/** @fileoverview Update registry package.json with exports, browser fields, and Node.js engine range. */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import builtinNames from '@socketregistry/packageurl-js/data/npm/builtin-names.json' with {
  type: 'json',
}
import fastGlob from 'fast-glob'

import { toSortedObject } from '#socketsecurity/lib/objects'
import { readPackageJson } from '#socketsecurity/lib/packages'

// Helper to write package.json with proper formatting
async function writePackageJson(filePath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`
  await fs.writeFile(filePath, content, 'utf8')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Constants for socket-lib
const constants = {
  EXT_DTS: '.d.ts',
  EXT_JSON: '.json',
  registryPkgPath: path.join(__dirname, '..'),
  ignoreGlobs: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.cache/**',
    '**/tmp/**',
    '**/.DS_Store',
  ],
  PACKAGE_DEFAULT_NODE_RANGE: '>=22',
}

const { EXT_DTS, EXT_JSON } = constants

/**
 * Generate exports and browser fields for registry package.
 */
async function main() {
  const { registryPkgPath } = constants
  const registryPkgJsonPath = path.join(registryPkgPath, 'package.json')

  const registryPkgJsonData = await readPackageJson(registryPkgJsonPath)

  // Create editable wrapper.
  const registryEditablePkgJson = {
    content: registryPkgJsonData,
    save: async function () {
      await writePackageJson(registryPkgJsonPath, this.content)
    },
    update: function (updates) {
      Object.assign(this.content, updates)
    },
  }

  const registryPkgJson = registryEditablePkgJson.content

  const browser = { ...registryPkgJson.browser }
  for (const builtinName of builtinNames) {
    browser[builtinName] = false
  }

  const registryPkgFiles = [
    ...(await fastGlob.glob(['**/*.{cjs,js,json,d.ts}'], {
      cwd: registryPkgPath,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/coverage/**',
        '**/.cache/**',
        '**/tmp/**',
        '**/.DS_Store',
        'dist/external/**',
        'scripts/**',
        'src/**',
      ],
      gitignore: false,
    })),
  ]

  const isDebug = !!process.env.DEBUG
  if (isDebug) {
    console.log('Found', registryPkgFiles.length, 'files')
    console.log('First 10:', registryPkgFiles.slice(0, 10))
  }

  const jsonExports = {}
  const subpathExports = registryPkgFiles.reduce((o, p) => {
    const ext = p.endsWith(EXT_DTS) ? EXT_DTS : path.extname(p)
    // Strip 'dist/' prefix from export path but keep it in file path.
    const exportPath = p.startsWith('dist/') ? p.slice(5) : p
    const filePath = `./${p}`

    if (ext === EXT_JSON) {
      jsonExports[`./${exportPath}`] = filePath
    } else {
      const extLessExportPath = `./${exportPath.slice(0, -ext.length)}`
      const isDts = ext === EXT_DTS
      if (o[extLessExportPath]) {
        o[extLessExportPath][isDts ? 'types' : 'default'] = filePath
      } else {
        o[extLessExportPath] = {
          // Order is significant. Default should be specified last.
          types: isDts ? filePath : undefined,
          default: isDts ? undefined : filePath,
        }
      }
      const basename = path.basename(exportPath, ext)
      if (basename === 'index') {
        const dirname = path.dirname(exportPath)
        const dirPath = dirname === '.' ? dirname : `./${dirname}`
        if (o[dirPath]) {
          o[dirPath][isDts ? 'types' : 'default'] = filePath
        } else {
          o[dirPath] = {
            // Order is significant. Default should be specified last.
            types: isDts ? filePath : undefined,
            default: isDts ? undefined : filePath,
          }
        }
      }
    }
    return o
  }, {})

  // Add kebab-case variants for all SCREAMING_SNAKE_CASE constant paths.
  // Map both kebab-case and SCREAMING_SNAKE_CASE paths to the same files.
  const aliasesToAdd = []
  for (const { 0: exportPath, 1: exportValue } of Object.entries(
    subpathExports,
  )) {
    if (
      exportPath.startsWith('./lib/constants/') &&
      exportPath !== './lib/constants'
    ) {
      const pathAfterConstants = exportPath.slice('./lib/constants/'.length)

      // Check if this is a SCREAMING_SNAKE_CASE name.
      if (
        pathAfterConstants.includes('_') &&
        /[A-Z]/.test(pathAfterConstants)
      ) {
        // Create kebab-case variant.
        const kebabCasePath = `./lib/constants/${pathAfterConstants.toLowerCase().replace(/_/g, '-')}`
        if (!subpathExports[kebabCasePath]) {
          aliasesToAdd.push([kebabCasePath, exportValue])
        }
      }

      // Check if this is a kebab-case name.
      if (
        pathAfterConstants.includes('-') &&
        pathAfterConstants === pathAfterConstants.toLowerCase()
      ) {
        // Create SCREAMING_SNAKE_CASE variant.
        const screamingSnakeCasePath = `./lib/constants/${pathAfterConstants.toUpperCase().replace(/-/g, '_')}`
        if (!subpathExports[screamingSnakeCasePath]) {
          aliasesToAdd.push([screamingSnakeCasePath, exportValue])
        }
      }
    }
  }

  // Add all aliases after iteration completes.
  for (const { 0: aliasPath, 1: aliasValue } of aliasesToAdd) {
    subpathExports[aliasPath] = aliasValue
  }

  // Create exports object with proper ordering:
  // 1. Main exports (. and ./index)
  // 2. SCREAMING_SNAKE_CASE constants
  // 3. kebab-case constants
  // 4. Non-constants lib exports
  // 5. JSON files
  const mainExports = {}
  const jsonExports2 = {}
  const libExports = {}
  const screamingSnakeCaseExports = {}
  const kebabCaseExports = {}

  for (const { 0: key, 1: value } of Object.entries({
    ...subpathExports,
    ...jsonExports,
  })) {
    if (key === '.' || key === './index') {
      mainExports[key] = value
    } else if (key.endsWith('.json')) {
      jsonExports2[key] = value
    } else if (key.startsWith('./lib/constants/')) {
      const pathAfterConstants = key.slice('./lib/constants/'.length)
      // SCREAMING_SNAKE_CASE paths contain _ or start with uppercase
      if (
        pathAfterConstants.includes('_') ||
        /^[A-Z]/.test(pathAfterConstants)
      ) {
        screamingSnakeCaseExports[key] = value
      } else {
        kebabCaseExports[key] = value
      }
    } else {
      // Non-constants lib paths
      libExports[key] = value
    }
  }

  // Ensure . comes before ./index
  const sortedMainExports = {}
  if (mainExports['.']) {
    sortedMainExports['.'] = mainExports['.']
  }
  if (mainExports['./index']) {
    sortedMainExports['./index'] = mainExports['./index']
  }

  const exports = {
    ...sortedMainExports,
    ...toSortedObject(screamingSnakeCaseExports),
    ...toSortedObject(kebabCaseExports),
    ...toSortedObject(libExports),
    ...toSortedObject(jsonExports2),
  }

  registryEditablePkgJson.update({
    browser: toSortedObject(browser),
    exports,
    engines: {
      ...registryEditablePkgJson.content.engines,
      node: constants.PACKAGE_DEFAULT_NODE_RANGE,
    },
  })
  await registryEditablePkgJson.save()
}

main().catch(console.error)
