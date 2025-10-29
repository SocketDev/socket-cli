#!/usr/bin/env node

/** @fileoverview Socket CLI entry point. */

void (async () => {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  // Execute the CLI bundle (decompresses cli.js.bz).
  require(path.join(rootPath, 'dist/index.js'))
})()
