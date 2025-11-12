#!/usr/bin/env node
/**
 * yarn wrapper entry point for Socket CLI with Sentry.
 * Loads the bundled CLI with Sentry integration in yarn mode.
 */

// Load the bundled CLI.
require('../dist/cli.js')
