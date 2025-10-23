#!/usr/bin/env node

/** @fileoverview Yarn CLI wrapper entry point. Forwards to Socket Firewall (sfw) for security scanning. */

void (async () => {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  const _yarnCli = require(path.join(rootPath, 'dist/yarn-cli.js'))

  // The yarn-cli module handles exit codes internally
})()
