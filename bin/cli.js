#!/usr/bin/env node
'use strict'

/** @fileoverview Socket CLI entry point. Executes the unified CLI bundle. */

void (async () => {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  // Execute the unified CLI bundle directly.
  // The unified CLI (dist/cli.js) handles all commands and detects how it was invoked.
  require(path.join(rootPath, 'dist/cli.js'))
})()
