#!/usr/bin/env node
/**
 * @fileoverview Copy logo images from repo root to packages/cli.
 */

import { cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(__dirname, '../../..')

const images = ['logo-dark.png', 'logo-light.png']

for (const image of images) {
  cpSync(path.join(repoRoot, image), path.join(packageRoot, image))
}

console.log('✓ Copied logos from repo root')
