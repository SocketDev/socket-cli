#!/usr/bin/env node
/**
 * pnpm wrapper entry point for Socket CLI with Sentry.
 * Loads the bundled CLI with Sentry integration in pnpm mode.
 */

// Load the bundled CLI.
require('../dist/cli.js')
