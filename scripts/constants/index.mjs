/** @fileoverview Centralized build constants for Socket CLI (re-exports all constants). */

import { envAsBoolean } from '@socketsecurity/registry/lib/env'

// Re-export all constants by category.
export * from './build.mjs'
export * from './env.mjs'
export * from './packages.mjs'
export * from './paths.mjs'
export * from './versions.mjs'

// Import all for default export.
import * as buildConstants from './build.mjs'
import * as envConstants from './env.mjs'
import {
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
} from './env.mjs'
import * as packagesConstants from './packages.mjs'
import * as pathsConstants from './paths.mjs'
import * as versionsConstants from './versions.mjs'

// Import what we need for ENV object.

// Build-time environment snapshot.
const { env } = process

export const ENV = Object.freeze({
  // Flag to determine if this is the Legacy build.
  [INLINED_SOCKET_CLI_LEGACY_BUILD]: envAsBoolean(
    env[INLINED_SOCKET_CLI_LEGACY_BUILD],
  ),
  // Flag to determine if this is a published build.
  [INLINED_SOCKET_CLI_PUBLISHED_BUILD]: envAsBoolean(
    env[INLINED_SOCKET_CLI_PUBLISHED_BUILD],
  ),
  // Flag to determine if this is the Sentry build.
  [INLINED_SOCKET_CLI_SENTRY_BUILD]: envAsBoolean(
    env[INLINED_SOCKET_CLI_SENTRY_BUILD],
  ),
})

// Default export with all constants.
export default {
  ...buildConstants,
  ...envConstants,
  ...packagesConstants,
  ...pathsConstants,
  ...versionsConstants,
  ENV,
}
