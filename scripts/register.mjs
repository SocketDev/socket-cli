/**
 * Module loader registration for Node.js --import flag.
 *
 * Registers our custom alias loader for @socketsecurity/* package imports.
 * This replaces the deprecated --loader flag with the new register() API.
 *
 * Usage:
 *   node --import=./scripts/register.mjs script.mjs
 *
 * Compatible with Node.js 18.19+, 20.6+, and 22+
 */

// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Register the alias loader using absolute path.
 
register(path.join(__dirname, 'utils', 'alias-loader.mjs'), import.meta.url)
