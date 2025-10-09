/**
 * @fileoverview Common utilities shared across scripts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Platform detection
export const WIN32 = process.platform === 'win32'
export const IS_WINDOWS = WIN32
export const IS_MACOS = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'
export const IS_CI = process.env.CI === 'true'

// Check if running in quiet mode
export const isQuiet = values => values?.quiet || values?.silent

// Get dirname from import.meta.url
export const getDirname = importMetaUrl =>
  path.dirname(fileURLToPath(importMetaUrl))

// Get root path from import.meta.url
export const getRootPath = importMetaUrl =>
  path.join(getDirname(importMetaUrl), '..')

// Common path helper
export const normalizePath = p => p.replace(/\\/g, '/')