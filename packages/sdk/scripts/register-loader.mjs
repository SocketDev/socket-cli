/**
 * @fileoverview Register alias loader for local Socket packages.
 * This module uses the modern register() API to load the alias-loader.
 */

// eslint-disable-next-line n/no-unsupported-features/node-builtins -- Required for loader registration
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const loaderPath = path.join(__dirname, 'utils', 'alias-loader.mjs')

// Register the alias loader using the modern API
register(pathToFileURL(loaderPath).href, import.meta.url)
