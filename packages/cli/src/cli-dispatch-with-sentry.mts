/**
 * @fileoverview CLI dispatch entry point with Sentry telemetry.
 * Imports Sentry instrumentation before running the CLI dispatcher.
 * This ensures Sentry is initialized before any CLI code runs.
 */

// CRITICAL: Import Sentry instrumentation FIRST (before any other CLI code).
// This must be the first import to ensure Sentry captures all errors.
import './instrument-with-sentry.mts'

// Import and run the normal CLI dispatch.
// The dispatch handles routing to the appropriate CLI based on invocation mode.
import './cli-dispatch.mts'
