#!/usr/bin/env node
'use strict'

/** @fileoverview Yarn CLI wrapper entry point. Forwards to Socket Firewall (sfw) for security scanning. */

async function main() {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  require(path.join(rootPath, 'dist/yarn-cli.js'))

  // The yarn-cli module handles exit codes internally
}

main().catch(console.error)
