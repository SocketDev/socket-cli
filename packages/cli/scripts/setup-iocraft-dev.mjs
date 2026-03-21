#!/usr/bin/env node
/**
 * @fileoverview Setup script to install iocraft dev build into node_modules for local testing.
 *
 * This simulates `npm install` of unpublished @socketaddon/iocraft packages.
 * Run before testing TUI renderers locally: node scripts/setup-iocraft-dev.mjs
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packagesDir = join(__dirname, '../../package-builder/build/dev/out')
const nodeModulesDir = join(__dirname, '../node_modules')

// Package mapping: source folder -> target node_modules path.
const packages = {
  'socketaddon-iocraft': '@socketaddon/iocraft',
  'socketaddon-iocraft-darwin-arm64': '@socketaddon/iocraft-darwin-arm64',
  'socketaddon-iocraft-darwin-x64': '@socketaddon/iocraft-darwin-x64',
  'socketaddon-iocraft-linux-arm64': '@socketaddon/iocraft-linux-arm64',
  'socketaddon-iocraft-linux-x64': '@socketaddon/iocraft-linux-x64',
  'socketaddon-iocraft-win-arm64': '@socketaddon/iocraft-win-arm64',
  'socketaddon-iocraft-win-x64': '@socketaddon/iocraft-win-x64',
}

console.log('Setting up iocraft dev build in node_modules...\n')

for (const [sourceDir, targetName] of Object.entries(packages)) {
  const sourcePath = join(packagesDir, sourceDir)

  if (!existsSync(sourcePath)) {
    console.log(`⊘ Skipping ${sourceDir} (not found)`)
    continue
  }

  const targetPath = join(nodeModulesDir, targetName)

  // Create @socketaddon directory if it doesn't exist.
  const scopeDir = dirname(targetPath)
  if (!existsSync(scopeDir)) {
    mkdirSync(scopeDir, { recursive: true })
  }

  // Create target directory.
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true })
  }

  // Copy package.json.
  const pkgJsonSource = join(sourcePath, 'package.json')
  const pkgJsonTarget = join(targetPath, 'package.json')
  if (existsSync(pkgJsonSource)) {
    copyFileSync(pkgJsonSource, pkgJsonTarget)
  }

  // Copy index.mjs (main package only).
  const indexSource = join(sourcePath, 'index.mjs')
  if (existsSync(indexSource)) {
    copyFileSync(indexSource, join(targetPath, 'index.mjs'))
  }

  // Copy .node file (platform packages - named "iocraft.node" in source).
  const nodeSource = join(sourcePath, 'iocraft.node')
  if (existsSync(nodeSource)) {
    copyFileSync(nodeSource, join(targetPath, 'iocraft.node'))
  }

  // Copy LICENSE and README.
  for (const file of ['LICENSE', 'README.md']) {
    const source = join(sourcePath, file)
    if (existsSync(source)) {
      copyFileSync(source, join(targetPath, file))
    }
  }

  console.log(`✓ Installed ${targetName}`)
}

// Patch the iocraft index.mjs to handle node_modules installation.
const iocraftIndexPath = join(nodeModulesDir, '@socketaddon/iocraft/index.mjs')
if (existsSync(iocraftIndexPath)) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  let indexContent = readFileSync(iocraftIndexPath, 'utf8')

  // Add fallback for node_modules installation if not already present.
  if (!indexContent.includes('Check if we\'re in node_modules')) {
    // First, add existsSync to the imports.
    indexContent = indexContent.replace(
      /const { realpathSync } = require\('node:fs'\)/,
      `const { realpathSync, existsSync } = require('node:fs')`,
    )

    // Then add the node_modules fallback logic.
    indexContent = indexContent.replace(
      /(\s+)(throw new Error\('Not in development build structure'\))/,
      `$1// Check if we're in node_modules (manual dev install).\n` +
        `$1// Expected: .../node_modules/@socketaddon/iocraft\n` +
        `$1if (realDir.includes('/node_modules/@socketaddon/iocraft')) {\n` +
        `$1  const packageDir = join(realDir, '..', \`iocraft-\${platformId}\`)\n` +
        `$1  const nodePath = join(packageDir, 'iocraft.node')\n` +
        `$1  if (existsSync(nodePath)) {\n` +
        `$1    // Load the .node file directly.\n` +
        `$1    const nativeModule = require(nodePath)\n` +
        `$1    return nativeModule\n` +
        `$1  }\n` +
        `$1}\n\n` +
        `$1$2`,
    )
    writeFileSync(iocraftIndexPath, indexContent, 'utf8')
    console.log('\n✓ Patched iocraft index.mjs for node_modules loading')
  }
}

// Create node_modules inside iocraft package and symlink platform packages.
// This allows iocraft's require() to find the platform-specific packages.
const iocraftNodeModules = join(nodeModulesDir, '@socketaddon/iocraft/node_modules')
const iocraftScope = join(iocraftNodeModules, '@socketaddon')

if (!existsSync(iocraftScope)) {
  mkdirSync(iocraftScope, { recursive: true })
}

// Symlink all platform packages into iocraft's node_modules.
for (const [sourceDir, targetName] of Object.entries(packages)) {
  if (targetName === '@socketaddon/iocraft') {
    continue // Skip main package.
  }

  const targetPath = join(nodeModulesDir, targetName)
  const symlinkPath = join(iocraftScope, targetName.replace('@socketaddon/', ''))

  if (existsSync(targetPath)) {
    try {
      if (existsSync(symlinkPath)) {
        // Remove existing symlink.
        const { unlinkSync } = await import('node:fs')
        unlinkSync(symlinkPath)
      }
      const { symlinkSync } = await import('node:fs')
      symlinkSync(targetPath, symlinkPath, 'dir')
      console.log(`  → Linked ${targetName} into iocraft/node_modules`)
    } catch (e) {
      console.log(`  ⚠ Failed to link ${targetName}:`, e.message)
    }
  }
}

console.log('\n✅ iocraft dev build installed successfully!')
console.log(
  '\nYou can now run manual tests:\n  node --experimental-strip-types src/commands/analytics/test-analytics-renderer.mts',
)
