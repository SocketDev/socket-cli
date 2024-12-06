#!/usr/bin/env node
'use strict'

const semver = require('semver')
const distType = semver.satisfies(process.versions.node, '>=22.12')
  ? 'module-sync'
  : 'require'
process.removeAllListeners('warning')
require(`../dist/${distType}/npx-cli.js`)
