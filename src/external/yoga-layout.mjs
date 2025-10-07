/**
 * @fileoverview Yoga-layout wrapper using patched synchronous entry point.
 *
 * Uses the patched yoga-layout/dist/src/sync.js entry point which provides
 * synchronous WASM loading via WebAssembly synchronous APIs.
 */

export { default } from 'yoga-layout/dist/src/sync.js'

export * from 'yoga-layout/dist/src/sync.js'
